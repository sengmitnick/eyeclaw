class BotChannel < ApplicationCable::Channel
  def subscribed
    # Bot is already authenticated at connection level
    reject unless current_bot

    @bot = current_bot
    @stream_name = "bot_#{@bot.id}"
    
    # Create new session
    @session_id = SecureRandom.uuid
    @bot.connect!(@session_id)

    stream_from @stream_name
    # stimulus-validator: disable-next-line
    # Commands stream for web dashboard (external integration, no frontend controller needed)
    stream_from "#{@stream_name}_commands"
    
    Rails.logger.info "[BotChannel] Bot #{@bot.id} subscribed to #{@stream_name} and #{@stream_name}_commands"

    # Send confirmation
    transmit({
      type: 'connected',
      bot_id: @bot.id,
      session_id: @session_id,
      message: 'Successfully connected to EyeClaw'
    })
  rescue StandardError => e
    handle_channel_error(e)
    reject
  end

  def unsubscribed
    @bot&.disconnect!
  rescue StandardError => e
    handle_channel_error(e)
  end

  # SDK sends ping to keep connection alive
  def ping(data)
    @bot.ping!
    
    transmit({
      type: 'pong',
      timestamp: Time.current.iso8601
    })
  end

  # Execute command on local OpenClaw
  def execute_command(data)
    command = data['command']
    params = data['params'] || {}
    
    Rails.logger.info "[BotChannel] execute_command called for bot #{@bot.id}"
    Rails.logger.info "[BotChannel] Command: #{command}, params: #{params.inspect[0..200]}"
    Rails.logger.info "[BotChannel] Source: #{data['metadata']&.[]('source') || 'unknown'}"

    # stimulus-validator: disable-next-line
    # Broadcast to MCP clients listening (external integration, no frontend controller needed)
    ActionCable.server.broadcast(
      "#{@stream_name}_mcp",
      {
        type: 'command_result',
        session_id: @session_id,
        command: command,
        params: params,
        timestamp: Time.current.iso8601
      }
    )
    
    Rails.logger.info "[BotChannel] Broadcasted to #{@stream_name}_mcp"

    transmit({
      type: 'command_received',
      command: command,
      status: 'processing'
    })
    
    Rails.logger.info "[BotChannel] Transmitted command_received to SDK"
  end

  # Get bot status
  def status(data)
    transmit({
      type: 'status_response',
      status: @bot.status,
      online: @bot.online?,
      active_sessions: @bot.bot_sessions.active.count,
      total_sessions: @bot.bot_sessions.count,
      uptime: @bot.active_session&.duration || 0
    })
  end

  # Send command result back to MCP
  def command_result(data)
    # stimulus-validator: disable-next-line
    # Broadcast to MCP clients (external integration, no frontend controller needed)
    ActionCable.server.broadcast(
      "#{@stream_name}_mcp",
      {
        type: 'result',
        session_id: @session_id,
        command: data['command'],
        result: data['result'],
        error: data['error'],
        timestamp: Time.current.iso8601
      }
    )
  end

  # Send log message
  def log(data)
    ActionCable.server.broadcast(
      @stream_name,
      {
        type: 'log',
        level: data['level'] || 'info',
        message: data['message'],
        timestamp: Time.current.iso8601
      }
    )
  end

  # Handle bot responses (from openclaw) - legacy support
  # Note: Rokid SSE now uses stream_chunk for real-time streaming
  def response(data)
    content = data['content']
    session_id = data['session_id']
    
    unless content.present? && session_id.present?
      Rails.logger.error "[BotChannel] Missing content or session_id in response"
      return
    end
    
    Rails.logger.info "[BotChannel] Received response for session #{session_id}: #{content[0..50]}..."
    
    transmit({ type: 'response_received', session_id: session_id, status: 'success' })
  end

  # Handle streaming chunks from OpenClaw Agent
  def stream_chunk(data)
    content = data['content'] || data['chunk']
    sequence = data['sequence'] # SDK 发送的序号
    # 使用消息中的 session_id，如果为空则使用连接时的 @session_id
    session_id = data['session_id'].present? ? data['session_id'] : @session_id
    
    Rails.logger.info "[BotChannel] Received stream_chunk ##{sequence} for session #{session_id}: #{content&.[](0..50)}..."
    
    # Broadcast streaming chunks to Rokid SSE clients (with sequence)
    ActionCable.server.broadcast(
      "rokid_sse_#{@bot.id}_#{session_id}",
      {
        type: 'stream_chunk',
        content: content,
        sequence: sequence, # 转发序号
        session_id: session_id,
        timestamp: Time.current.iso8601
      }
    )
    
    # Also broadcast to dashboard clients
    ActionCable.server.broadcast(
      @stream_name,
      {
        type: 'stream_chunk',
        content: content,
        sequence: sequence, # 转发序号
        session_id: session_id,
        timestamp: Time.current.iso8601
      }
    )
  end
  
  # Handle stream end
  def stream_end(data)
    session_id = data['session_id']
    
    Rails.logger.info "[BotChannel] Stream ended for session #{session_id}"
    
    # Broadcast to Rokid SSE clients
    ActionCable.server.broadcast(
      "rokid_sse_#{@bot.id}_#{session_id}",
      {
        type: 'stream_end',
        session_id: session_id,
        timestamp: Time.current.iso8601
      }
    )
  end
  
  # Handle stream error
  def stream_error(data)
    session_id = data['session_id']
    error = data['error']
    
    Rails.logger.error "[BotChannel] Stream error for session #{session_id}: #{error}"
    
    # Broadcast to Rokid SSE clients
    ActionCable.server.broadcast(
      "rokid_sse_#{@bot.id}_#{session_id}",
      {
        type: 'stream_error',
        error: error,
        session_id: session_id,
        timestamp: Time.current.iso8601
      }
    )
  end

  # Route incoming messages based on type
  def receive(data)
    Rails.logger.info "[BotChannel] receive called with data: #{data.inspect[0..200]}"
    
    case data['type']
    when 'stream_chunk'
      stream_chunk(data)
    when 'stream_end'
      stream_end(data)
    when 'stream_error'
      stream_error(data)
    when 'pong'
      # Client pong response, can be ignored or logged
      Rails.logger.debug "[BotChannel] Received pong from client"
    else
      Rails.logger.warn "[BotChannel] Unknown message type: #{data['type']}"
    end
  end

  private

  # Remove obsolete current_user override - now handled at connection level
end

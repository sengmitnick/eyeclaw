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

    transmit({
      type: 'command_received',
      command: command,
      status: 'processing'
    })
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

  # Handle streaming chunks from OpenClaw Agent
  def stream_chunk(data)
    # Broadcast streaming chunks to dashboard clients
    ActionCable.server.broadcast(
      @stream_name,
      {
        type: 'stream_chunk',
        stream_type: data['type'], # stream_start, stream_chunk, stream_end, stream_error
        stream_id: data['stream_id'],
        chunk: data['chunk'],
        timestamp: data['timestamp'] || Time.current.iso8601
      }
    )
  end

  private

  # Remove obsolete current_user override - now handled at connection level
end

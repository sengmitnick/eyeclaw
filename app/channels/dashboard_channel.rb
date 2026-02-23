class DashboardChannel < ApplicationCable::Channel
  def subscribed
    # Authenticate user first
    reject unless current_user
    
    # Extract bot_id from stream name (e.g., "bot_123" -> 123)
    @stream_name = params[:stream_name]
    reject unless @stream_name
    
    bot_id = @stream_name.split('_').last.to_i
    @bot = current_user.bots.find_by(id: bot_id)
    reject unless @bot

    stream_from @stream_name
  rescue StandardError => e
    handle_channel_error(e)
    reject
  end

  def unsubscribed
    # Any cleanup needed when channel is unsubscribed
  rescue StandardError => e
    handle_channel_error(e)
  end

  # Request bot status update
  def status(data)
    ActionCable.server.broadcast(
      @stream_name,
      {
        type: 'status_response',
        status: @bot.status,
        online: @bot.online?,
        active_sessions: @bot.bot_sessions.active.count,
        total_sessions: @bot.bot_sessions.count,
        uptime: @bot.active_session&.duration || 0
      }
    )
  end

  # Execute command - forward to bot via BotChannel
  def execute_command(data)
    command = data['command']
    params = data['params'] || {}

    # stimulus-validator: disable-next-line
    # Broadcast to bot's channel (BotChannel subscribers will receive this, external SDK integration)
    ActionCable.server.broadcast(
      "#{@stream_name}_commands",
      {
        type: 'execute_command',
        command: command,
        params: params,
        timestamp: Time.current.iso8601
      }
    )

    # For demo/testing: simulate bot response if bot is offline
    unless @bot.online?
      ActionCable.server.broadcast(
        @stream_name,
        {
          type: 'message',
          message: "Bot is offline. Cannot process command: #{command}",
          timestamp: Time.current.iso8601
        }
      )
    end
  end

  # Send ping to bot
  def ping(data)
    # stimulus-validator: disable-next-line
    # Broadcast to bot's channel (BotChannel subscribers will receive this, external SDK integration)
    ActionCable.server.broadcast(
      "#{@stream_name}_commands",
      {
        type: 'ping',
        timestamp: Time.current.iso8601
      }
    )
  end

  # Request help
  def help(data)
    ActionCable.server.broadcast(
      @stream_name,
      {
        type: 'message',
        message: "Available commands:\n- ping: Test connection\n- status: Get bot status\n- chat: Send a message\n- help: Show this help",
        timestamp: Time.current.iso8601
      }
    )
  end

  private

  def current_user
    @current_user ||= connection.current_user
  end
end

class McpController < ApplicationController
  skip_before_action :verify_authenticity_token, only: [:stream]
  before_action :authenticate_bot_with_api_key, only: [:stream]

  # SSE Stream endpoint for MCP integration
  def stream
    response.headers['Content-Type'] = 'text/event-stream'
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'

    sse = SSE.new(response.stream, retry: 300, event: 'message')

    begin
      # Send initial connection event
      sse.write({ type: 'connected', bot_id: @bot.id, name: @bot.name }, event: 'message')

      # Handle incoming messages
      loop do
        data = parse_request_body
        
        case data['type']
        when 'ping'
          @bot.ping!
          sse.write({ type: 'pong', timestamp: Time.current.iso8601 }, event: 'message')
        when 'execute'
          # Execute command via ActionCable to SDK
          result = execute_command(data['command'], data['params'])
          sse.write({ type: 'result', data: result }, event: 'message')
        when 'status'
          sse.write({ 
            type: 'status', 
            status: @bot.status,
            online: @bot.online?,
            active_sessions: @bot.bot_sessions.active.count
          }, event: 'message')
        else
          sse.write({ type: 'error', message: 'Unknown command type' }, event: 'message')
        end

        sleep 0.1 # Prevent tight loop
      end
    rescue IOError, Errno::EPIPE
      # Client disconnected
    ensure
      sse.close
    end
  end

  # GET endpoint for MCP metadata
  def metadata
    @bot = Bot.find(params[:bot_id])
    
    # Return plain text metadata (MCP can parse this)
    response_text = [
      "Name: #{@bot.name}",
      "Description: #{@bot.description}",
      "Version: 1.0.0",
      "Stream URL: #{mcp_stream_url(bot_id: @bot.id)}",
      "Webhook URL: #{@bot.webhook_url}",
      "Authentication: API Key (X-Api-Key header)"
    ].join("\n")

    render plain: response_text
  end

  private

  def authenticate_bot_with_api_key
    api_key = request.headers['X-Api-Key'] || params[:api_key]
    @bot = Bot.find_by(api_key: api_key)

    unless @bot
      render plain: 'Invalid API key', status: :unauthorized
    end
  end

  def parse_request_body
    return {} unless request.body

    body = request.body.read
    request.body.rewind
    
    JSON.parse(body) rescue {}
  end

  def execute_command(command, params = {})
    # Broadcast to ActionCable channel for SDK to handle
    ActionCable.server.broadcast(
      "bot_#{@bot.id}",
      {
        type: 'execute_command',
        command: command,
        params: params,
        timestamp: Time.current.iso8601
      }
    )

    # Wait for response (with timeout)
    # In production, this should use a proper queue/job system
    { status: 'queued', command: command }
  end

  class SSE
    def initialize(io, options = {})
      @io = io
      @options = options
    end

    def write(object, options = {})
      options.each do |k, v|
        @io.write "#{k}: #{v}\n"
      end
      @io.write "data: #{JSON.generate(object)}\n\n"
    rescue IOError, Errno::EPIPE
      # Connection closed
    end

    def close
      @io.close
    rescue IOError
      # Already closed
    end
  end
end

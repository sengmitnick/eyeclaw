# Rokid Lingzhu MCP Controller
# 实现符合 Rokid MCP 协议的接口
#
# 协议流程：
# 1. 客户端调用 GET /mcp/rokid/sse 获取 session endpoint
# 2. 服务端通过 SSE 返回包含 session_id 的 endpoint  
# 3. 客户端通过 POST /messages/?session_id=xxx 发送 JSON-RPC 2.0 请求
# 4. 服务端直接返回结果
#
# Bot 关联方式：
# - 工具调用时在 arguments 中传入 botId 参数（必需）
# - 可选传入 deviceId 参数或在 X-Device-Id header 中传递设备 ID
class McpController < ApplicationController
  include ActionController::Live
  
  skip_before_action :verify_authenticity_token
  skip_before_action :authenticate_user!, if: :authenticate_user_defined?

  # Session 存储（生产环境应使用 Redis）
  @@sessions = {}
  # SSE streams for pushing messages
  @@streams = {}

  # GET /mcp/rokid/sse
  # 返回包含 session_id 的 endpoint信息（通过 SSE）
  def sse
    # 设置 SSE 响应头
    response.headers['Content-Type'] = 'text/event-stream'
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    
    begin
      session_id = SecureRandom.hex(16)

      # 存储 session
      @@sessions[session_id] = {
        created_at: Time.current,
        last_activity: Time.current
      }

      # 存储 SSE stream 引用，用于后续推送消息
      @@streams[session_id] = response.stream

      # SSE 格式匹配 Rokid 官方：
      # event: endpoint
      # data: /messages/?session_id=xxx
      # (双换行符)
      response.stream.write "event: endpoint\n"
      response.stream.write "data: /messages/?session_id=#{session_id}\n\n"
      
      # 保持连接活跃，每 15 秒发送心跳（匹配官方实现）
      loop do
        sleep 15
        # SSE 注释行格式作为心跳
        response.stream.write ": ping - #{Time.current}\n\n"
      end
    rescue IOError, Errno::EPIPE
      # 客户端断开连接
      Rails.logger.info "SSE client disconnected for session #{session_id}"
    ensure
      @@sessions.delete(session_id) if session_id
      @@streams.delete(session_id) if session_id
      response.stream.close
    end
  end

  # POST /messages/
  # 处理 JSON-RPC 2.0 请求
  # 返回 Accepted，然后通过 SSE 推送结果
  def messages
    session_id = params[:session_id]

    unless session_id && @@sessions[session_id]
      render json: jsonrpc_error(nil, -32600, 'Invalid session_id'), status: :bad_request
      return
    end

    # 更新 session 活动时间
    @@sessions[session_id][:last_activity] = Time.current

    # 解析 JSON-RPC 2.0 请求
    request_data = JSON.parse(request.body.read) rescue nil
    
    unless request_data && request_data['jsonrpc'] == '2.0'
      render json: jsonrpc_error(nil, -32700, 'Parse error'), status: :bad_request
      return
    end

    rpc_id = request_data['id']
    method = request_data['method']
    params_data = request_data['params'] || {}

    # 路由到对应的方法处理
    result = case method
    when 'tools/list'
      handle_tools_list(params_data)
    when 'tools/call'
      handle_tools_call(params_data, session_id)
    else
      { error: jsonrpc_error(rpc_id, -32601, 'Method not found') }
    end

    # 立即返回 Accepted (纯文本格式)
    render plain: "Accepted", status: :accepted

    # 通过 SSE 推送实际结果
    push_result_via_sse(session_id, rpc_id, result)
  end

  # 通过 SSE 推送结果
  def push_result_via_sse(session_id, rpc_id, result)
    # 获取该 session 的 SSE stream
    stream = @@streams[session_id]
    
    Rails.logger.info "[MCP] push_result_via_sse called for session: #{session_id}, stream exists: #{!stream.nil?}"
    
    return unless stream

    response_data = if result[:error]
                      result[:error]
                    else
                      jsonrpc_response(rpc_id, result[:data])
                    end

    # SSE 格式：event: message, data: JSON
    stream_response = "event: message\ndata: #{response_data.to_json}\n\n"
    
    begin
      stream.write stream_response
      Rails.logger.info "[MCP] Successfully wrote to SSE stream: #{stream_response}"
    rescue IOError, Errno::EPIPE => e
      Rails.logger.info "[MCP] SSE stream write failed for session #{session_id}: #{e.message}"
    end
  end

  private

  # 处理 tools/list 请求
  # 返回可用的工具列表
  def handle_tools_list(_params)
    tools = [
      {
        name: 'send_message',
        description: 'Send a message to the bot and get response',
        inputSchema: {
          type: 'object',
          properties: {
            botId: {
              type: 'string',
              description: 'Bot ID (required)'
            },
            message: {
              type: 'string',
              description: 'Message content to send to the bot'
            },
            deviceId: {
              type: 'string',
              description: 'Device ID for authentication (optional, can also use X-Device-Id header)'
            }
          },
          required: ['botId', 'message']
        }
      },
      {
        name: 'get_bot_info',
        description: 'Get bot information and status',
        inputSchema: {
          type: 'object',
          properties: {
            botId: {
              type: 'string',
              description: 'Bot ID (required)'
            },
            deviceId: {
              type: 'string',
              description: 'Device ID for authentication (optional)'
            }
          },
          required: ['botId']
        }
      }
    ]

    { data: { tools: tools } }
  end

  # 处理 tools/call 请求
  # 执行具体的工具调用
  def handle_tools_call(params, session_id)
    tool_name = params['name']
    arguments = params['arguments'] || {}

    # 从 arguments 或 header 获取 botId 和 deviceId
    bot_id = arguments['botId']
    device_id = arguments['deviceId'] || request.headers['X-Device-Id']

    unless bot_id
      return { error: jsonrpc_error(nil, -32602, 'Missing required parameter: botId') }
    end

    # 查找并验证 Bot
    bot = Bot.find_by(id: bot_id)
    unless bot
      return { error: jsonrpc_error(nil, -32602, "Bot not found: #{bot_id}") }
    end

    # 验证设备 ID（如果 Bot 配置了 rokid_device_id）
    if bot.rokid_device_id.present? && device_id != bot.rokid_device_id
      return { error: jsonrpc_error(nil, -32603, 'Device unauthorized') }
    end

    # 根据工具名称执行对应操作
    case tool_name
    when 'send_message'
      execute_send_message(bot, arguments, session_id)
    when 'get_bot_info'
      execute_get_bot_info(bot, arguments)
    else
      { error: jsonrpc_error(nil, -32601, "Unknown tool: #{tool_name}") }
    end
  end

  # 执行 send_message 工具
  def execute_send_message(bot, arguments, session_id)
    message = arguments['message']
    
    unless message.present?
      return { error: jsonrpc_error(nil, -32602, 'Missing required parameter: message') }
    end

    # 通过 ActionCable 发送消息到 Bot
    ActionCable.server.broadcast(
      "bot_#{bot.id}",
      {
        type: 'message',
        content: message,
        session_id: session_id,
        timestamp: Time.current.iso8601
      }
    )

    # 更新 Bot 活动时间
    bot.ping!

    { data: {
      status: 'sent',
      bot_id: bot.id,
      bot_name: bot.name,
      message: message,
      timestamp: Time.current.iso8601
    }}
  end

  # 执行 get_bot_info 工具
  def execute_get_bot_info(bot, _arguments)
    { data: {
      id: bot.id,
      name: bot.name,
      description: bot.description,
      status: bot.status,
      online: bot.online?,
      active_sessions: bot.bot_sessions.active.count,
      last_seen: bot.active_session&.last_ping_at&.iso8601
    }}
  end

  # 检查是否定义了 authenticate_user! 方法
  def authenticate_user_defined?
    respond_to?(:authenticate_user!)
  end

  # JSON-RPC 2.0 响应格式
  def jsonrpc_response(id, result)
    {
      jsonrpc: '2.0',
      id: id,
      result: result
    }
  end

  # JSON-RPC 2.0 错误响应格式
  def jsonrpc_error(id, code, message, data = nil)
    error_response = {
      jsonrpc: '2.0',
      id: id,
      error: {
        code: code,
        message: message
      }
    }
    error_response[:error][:data] = data if data
    error_response
  end

  # 清理超时的 session（30分钟无活动）
  def cleanup_inactive_sessions
    timeout = 30.minutes.ago
    @@sessions.delete_if do |session_id, session_data|
      session_data[:last_activity] < timeout
    end
  end
end

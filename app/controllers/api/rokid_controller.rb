# API::RokidController
# 为Cloudflare Worker提供的HTTP API endpoints
#
# POST /api/rokid/trigger - 触发OpenClaw处理，返回bot_id
# GET /api/rokid/poll - 长轮询获取stream chunks
class Api::RokidController < ApplicationController
  # 跳过CSRF保护（API endpoint）
  skip_before_action :verify_authenticity_token
  
  # 全局Access Key鉴权
  before_action :authenticate_with_access_key
  
  # POST /api/rokid/trigger
  # 触发OpenClaw处理并开始广播chunks
  #
  # 参数：
  # - message_id: Session ID
  # - agent_id: Agent ID（可能是bot_id或agent slug）
  # - message: 消息数组 [{ role, content }]
  # - user_id: 用户ID（可选）
  # - metadata: 元数据（可选）
  # - bot_id: Bot ID（可选，如果提供则优先使用）
  #
  # 返回：
  # - { bot_id, session_id, status: 'triggered' }
  def trigger
    message_id = params[:message_id]
    agent_id = params[:agent_id]
    message = params[:message]
    user_id = params[:user_id]
    metadata = params[:metadata] || {}
    bot_id_param = params[:bot_id]
    
    # 验证必填参数
    unless message_id && agent_id && message.is_a?(Array)
      return render json: { error: 'Missing required parameters' }, status: :bad_request
    end
    
    # 查找Bot
    bot = if bot_id_param.present?
            Bot.find_by(id: bot_id_param)
          else
            Bot.find_by(id: agent_id) || Bot.find_by(slug: agent_id)
          end
    
    unless bot
      return render json: { error: 'Bot not found' }, status: :not_found
    end
    
    # 构建command（复用现有BotChannel逻辑）
    # 注意：SDK 从 metadata.session_id 提取 session_id
    command = {
      type: 'execute_command',  # SDK 期望的字段
      command: 'chat',          # 实际命令类型
      params: {
        message: message.first&.dig('text') || message.first&.to_s
      },
      message: message,
      user_id: user_id,
      metadata: metadata.merge({ session_id: message_id })  # session_id 必须放在 metadata 里！
    }
    
    # 广播到BotChannel（这会触发OpenClaw处理并广播chunks到 rokid_sse_#{bot.id}_#{message_id}）
    ActionCable.server.broadcast(
      "bot_#{bot.id}",
      command
    )
    
    Rails.logger.info "[RokidAPI] Triggered OpenClaw processing for bot_id=#{bot.id}, session_id=#{message_id}"
    
    render json: {
      bot_id: bot.id,
      session_id: message_id,
      status: 'triggered'
    }
  end
  
  # GET /api/rokid/poll
  # 长轮询获取stream chunks
  #
  # 参数：
  # - bot_id: Bot ID
  # - session_id: Session ID
  # - Last-Event-ID: 上次接收的事件ID（HTTP header）
  #
  # 返回：
  # - [{ id, type, content/error, timestamp }]
  def poll
    bot_id = params[:bot_id]
    session_id = params[:session_id]
    last_event_id = request.headers['Last-Event-ID'].to_i
    
    unless bot_id && session_id
      return render json: { error: 'Missing required parameters' }, status: :bad_request
    end
    
    # 这是一个简化实现：从Redis或内存队列读取pending events
    # 在生产环境中，你需要实现一个事件队列系统
    
    # 临时方案：使用ActionCable订阅机制
    # 我们让Worker直接使用WebSocket连接ActionCable，而不是HTTP轮询
    # 这个endpoint仅作为fallback
    
    # 返回空数组，因为主要逻辑应该使用WebSocket
    render json: []
  end
  
  private
  
  def authenticate_with_access_key
    auth_header = request.headers['Authorization']
    
    unless auth_header&.start_with?('Bearer ')
      render json: { error: 'Missing Authorization header' }, status: :unauthorized
      return
    end
    
    access_key_value = auth_header.sub('Bearer ', '')
    @access_key = AccessKey.find_and_touch(access_key_value)
    
    unless @access_key
      render json: { error: 'Invalid or inactive access key' }, status: :unauthorized
    end
  end
end

# RokidStreamChannel
# 专门为Cloudflare Worker提供的WebSocket订阅频道
# Worker通过此Channel订阅实时流式数据，然后通过SSE转发给Rokid客户端
#
# 订阅参数：
# - access_key: 全局Access Key（用于鉴权）
# - bot_id: Bot ID
# - session_id: Session ID（对应message_id）
#
# 接收消息类型：
# - stream_chunk: { content: "...", session_id: "..." }
# - stream_end: { session_id: "..." }
# - stream_error: { error: "...", session_id: "..." }
class RokidStreamChannel < ApplicationCable::Channel
  def subscribed
    # 验证参数
    access_key_value = params[:access_key]
    @bot_id = params[:bot_id]
    @session_id = params[:session_id]
    
    unless access_key_value && @bot_id && @session_id
      Rails.logger.error "[RokidStreamChannel] Missing required params: access_key=#{access_key_value.present?}, bot_id=#{@bot_id}, session_id=#{@session_id}"
      reject
      return
    end
    
    # 验证Access Key
    access_key = AccessKey.find_and_touch(access_key_value)
    unless access_key
      Rails.logger.error "[RokidStreamChannel] Invalid or inactive access_key"
      reject
      return
    end
    
    # 验证Bot存在
    @bot = Bot.find_by(id: @bot_id)
    unless @bot
      Rails.logger.error "[RokidStreamChannel] Bot not found: #{@bot_id}"
      reject
      return
    end
    
    # 订阅该session的流式数据频道
    @channel_name = "rokid_sse_#{@bot_id}_#{@session_id}"
    stream_from @channel_name
    
    Rails.logger.info "[RokidStreamChannel] Subscribed to #{@channel_name} (access_key: #{access_key.name})"
    
    # 发送连接确认
    transmit({
      type: 'connected',
      bot_id: @bot_id,
      session_id: @session_id,
      channel: @channel_name,
      timestamp: Time.current.iso8601
    })
  end
  
  def unsubscribed
    Rails.logger.info "[RokidStreamChannel] Unsubscribed from #{@channel_name}"
  end
  
  # 接收来自Worker的ping（保持连接）
  def ping(data)
    transmit({
      type: 'pong',
      timestamp: Time.current.iso8601
    })
  end
end

# Rokid Lingzhu SSE Controller
# 实现符合灵珠平台自定义智能体 SSE 协议的接口
#
# 协议说明：
# - POST /sse/rokid
# - Authorization: Bearer $智能体鉴权AK
# - 请求参数：message_id, agent_id, user_id, message[], metadata
# - 响应格式：SSE Stream
#   - event: message (内容输出)
#   - event: done (结束)
#   - data: JSON 包含 role, message_id, agent_id, answer_stream, is_finish, type
class RokidSseController < ApplicationController
  include ActionController::Live
  
  skip_before_action :verify_authenticity_token
  skip_before_action :authenticate_user!, if: :authenticate_user_defined?
  
  # 类变量：记录正在等待绑定拍照的 message_id 和 agent_id
  # 格式: { "message_id" => "agent_id" }
  @@pending_binding_photos = {}

  # POST /sse/rokid
  # 灵珠平台 SSE 接口
  def sse
    # 设置 SSE 响应头
    response.headers['Content-Type'] = 'text/event-stream'
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    
    begin
      # 解析请求参数
      request_data = JSON.parse(request.body.read)
      
      # 验证必填字段
      message_id = request_data['message_id']
      agent_id = request_data['agent_id']
      messages = request_data['message'] || []
      user_id = request_data['user_id']
      metadata = request_data['metadata'] || {}
      
      unless message_id && agent_id && messages.present?
        send_error_event('Missing required parameters: message_id, agent_id, or message')
        return
      end
      
      # 验证全局 Access Key
      auth_token = extract_bearer_token
      unless auth_token
        send_error_event('Missing Authorization header')
        return
      end
      
      access_key = AccessKey.find_and_touch(auth_token)
      unless access_key
        send_error_event('Invalid or inactive Access Key')
        return
      end
      
      Rails.logger.info "[RokidSSE] Received request - message_id: #{message_id}, agent_id: #{agent_id}, access_key: #{access_key.name}"
      
      # 检查是否在等待绑定拍照的上下文中
      if @@pending_binding_photos[message_id] == agent_id
        # 检查是否收到了图片（拍照结果）
        image_message = extract_image_message(messages)
        if image_message && image_message['image_url'].present?
          Rails.logger.info "[RokidSSE] Received binding photo for message_id: #{message_id}"
          handle_binding_photo_result(message_id, agent_id, image_message['image_url'])
          return
        end
      end
      
      # 通过 agent_id 查找关联的 Bot
      # agent_id 可以是：
      # 1. rokid_device_id（Rokid 眼镜绑定后的设备 ID）
      # 2. bot.id（Web Chat 使用 Bot ID）
      bot = Bot.find_by(rokid_device_id: agent_id) || Bot.find_by(id: agent_id)
      
      # 如果未找到绑定的 Bot，发送拍照指令让用户扫描网页上的二维码
      unless bot
        Rails.logger.info "[RokidSSE] Bot not found for agent_id: #{agent_id}, sending take_photo command"
        # 记录此 message_id 正在等待绑定拍照
        @@pending_binding_photos[message_id] = agent_id
        send_binding_photo_request(message_id, agent_id)
        return
      end
      
      Rails.logger.info "[RokidSSE] Found bot: #{bot.name} (ID: #{bot.id})"
      
      # 提取最后一条用户消息
      last_user_message = extract_last_user_message(messages)
      
      # 通过 ActionCable 发送命令到本地 openclaw（使用 bot_X_commands 频道）
      # 这与 DashboardChannel#execute_command 的格式一致
      # BotChannel 订阅了 bot_1_commands，所以 SDK 可以接收到此消息
      command_payload = {
        type: 'execute_command',
        command: 'chat',
        params: { message: last_user_message },
        metadata: {
          source: 'rokid_lingzhu',
          agent_id: agent_id,
          user_id: user_id,
          full_messages: messages,
          original_metadata: metadata,
          session_id: message_id  # 用于追踪响应
        },
        timestamp: Time.current.iso8601
      }
      
      Rails.logger.info "[RokidSSE] Broadcasting command to bot_#{bot.id}_commands"
      Rails.logger.info "[RokidSSE] Command payload: #{command_payload.to_json[0..200]}"
      
      ActionCable.server.broadcast(
        "bot_#{bot.id}_commands",
        command_payload
      )
      
      Rails.logger.info "[RokidSSE] Broadcast completed, checking active subscriptions..."
      
      # 检查有多少客户端订阅了这个频道
      connections_count = ActionCable.server.connections.size
      Rails.logger.info "[RokidSSE] Active ActionCable connections: #{connections_count}"
      
      # 订阅 ActionCable 频道以接收流式响应
      stream_id = nil
      accumulated_content = ""
      streaming_active = false
      idle_timeout = 60  # 空闲超时：60秒内没有收到任何消息才超时
      last_message_time = Time.current
      
      # 创建临时订阅以监听流式响应
      subscription_channel = "bot_#{bot.id}"
      
      # 使用 ActionCable 的内部订阅机制（Redis pubsub）
      cable = ActionCable.server.pubsub
      
      # 创建一个队列来接收消息
      message_queue = Queue.new
      stream_finished = false
      
      # 订阅频道 - 对于 async adapter，我们需要直接从内部的广播系统监听
      # 使用 Fiber 和 Queue 来实现异步监听
      
      callback = ->(data) {
        begin
          Rails.logger.info "[RokidSSE] ===== Received broadcast on #{subscription_channel}: #{data.inspect[0..300]}"
          
          # ActionCable async adapter 传递的是 JSON 字符串，需要解析
          parsed_data = if data.is_a?(String)
            JSON.parse(data)
          elsif data.is_a?(Hash)
            data
          else
            Rails.logger.warn "[RokidSSE] Unexpected data type: #{data.class}"
            return
          end
          
          Rails.logger.debug "[RokidSSE] Broadcast type: #{parsed_data['type']}"
          message_queue << parsed_data
          last_message_time = Time.current  # 更新最后消息时间
        rescue JSON::ParserError => e
          Rails.logger.error "[RokidSSE] JSON parse error: #{e.message}, data: #{data[0..200]}"
        rescue => e
          Rails.logger.error "[RokidSSE] Error processing broadcast: #{e.message}"
        end
      }
      
      # 直接订阅 ActionCable 的内部广播
      cable.subscribe(subscription_channel, callback)
      Rails.logger.info "[RokidSSE] Subscribed to channel: #{subscription_channel}"
      
      begin
        # 循环接收流式消息
        loop do
          # 检查空闲超时（只有在没有收到任何消息的情况下才超时）
          if Time.current - last_message_time > idle_timeout
            Rails.logger.warn "[RokidSSE] Idle timeout: no message received for #{idle_timeout} seconds"
            break
          end
          
          # 非阻塞获取消息（等待最多 0.5 秒）
          begin
            data = message_queue.pop(true)
          rescue ThreadError
            # 队列为空，短暂休眠后继续
            sleep 0.1
            next
          end
          
          # 处理不同类型的消息
          case data['type']
          when 'stream_chunk'
            stream_type = data['stream_type']
            chunk_stream_id = data['stream_id']
            chunk = data['chunk']
            
            Rails.logger.debug "[RokidSSE] Stream event: #{stream_type}, chunk: #{chunk[0..50] if chunk}"
            
            case stream_type
            when 'stream_start'
              stream_id = chunk_stream_id
              streaming_active = true
              Rails.logger.info "[RokidSSE] Stream started: #{stream_id}"
              
            when 'stream_chunk'
              if streaming_active && chunk.present?
                # 实时发送 chunk 到 Rokid SSE
                event_data = {
                  role: 'agent',
                  type: 'answer',
                  answer_stream: chunk,
                  message_id: message_id,
                  agent_id: agent_id,
                  is_finish: false
                }
                write_sse_event('message', event_data)
                accumulated_content += chunk
              end
              
            when 'stream_end'
              Rails.logger.info "[RokidSSE] Stream ended: #{stream_id}"
              streaming_active = false
              stream_finished = true
              
              # 发送完成标记
              final_data = {
                role: 'agent',
                type: 'answer',
                answer_stream: '',
                message_id: message_id,
                agent_id: agent_id,
                is_finish: true
              }
              write_sse_event('message', final_data)
              send_done_event(message_id, agent_id)
              break
              
            when 'stream_error'
              Rails.logger.error "[RokidSSE] Stream error: #{chunk}"
              error_message = "处理出错：#{chunk}"
              event_data = {
                role: 'agent',
                type: 'answer',
                answer_stream: error_message,
                message_id: message_id,
                agent_id: agent_id,
                is_finish: true
              }
              write_sse_event('message', event_data)
              send_done_event(message_id, agent_id)
              stream_finished = true
              break
            end
            
          when 'log'
            # 记录日志但不发送给用户
            Rails.logger.info "[RokidSSE] Bot log [#{data['level']}]: #{data['message']}"
            
          else
            # 忽略其他类型的消息（如 status_response, pong 等）
            Rails.logger.debug "[RokidSSE] Ignored message type: #{data['type']}"
          end
        end
        
        # 如果循环结束但流没有正常完成（空闲超时）
        unless stream_finished
          Rails.logger.warn "[RokidSSE] Stream did not finish properly (idle timeout or client disconnect)"
          
          if accumulated_content.present?
            # 有部分内容，发送完成标记
            final_data = {
              role: 'agent',
              type: 'answer',
              answer_stream: '',
              message_id: message_id,
              agent_id: agent_id,
              is_finish: true
            }
            write_sse_event('message', final_data)
            send_done_event(message_id, agent_id)
          else
            # 没有收到任何内容，发送超时消息
            timeout_message = "抱歉，我暂时无法响应。请确保本地 OpenClaw 已正确连接。"
            event_data = {
              role: 'agent',
              type: 'answer',
              answer_stream: timeout_message,
              message_id: message_id,
              agent_id: agent_id,
              is_finish: true
            }
            write_sse_event('message', event_data)
            send_done_event(message_id, agent_id)
          end
        end
        
      ensure
        # 取消订阅
        cable.unsubscribe(subscription_channel, callback)
        Rails.logger.info "[RokidSSE] Unsubscribed from channel: #{subscription_channel}"
      end
      
      # 更新 Bot 活动时间
      bot.ping!
      
    rescue JSON::ParserError => e
      send_error_event("Invalid JSON: #{e.message}")
    rescue StandardError => e
      Rails.logger.error "[RokidSSE] Error: #{e.message}\n#{e.backtrace.join("\n")}"
      send_error_event("Internal server error: #{e.message}")
    ensure
      response.stream.close
    end
  end

  private

  # 提取 Bearer Token
  def extract_bearer_token
    auth_header = request.headers['Authorization']
    return nil unless auth_header
    
    match = auth_header.match(/^Bearer\s+(.+)$/i)
    match ? match[1] : nil
  end

  # 提取图片消息
  def extract_image_message(messages)
    messages.reverse.each do |msg|
      return msg if msg['type'] == 'image' && msg['role'] == 'user'
    end
    nil
  end

  # 处理绑定拍照结果
  def handle_binding_photo_result(message_id, agent_id, image_url)
    Rails.logger.info "[RokidSSE] Processing binding photo result for agent_id: #{agent_id}"
    Rails.logger.info "[RokidSSE] Image URL: #{image_url}"
    
    # 调用二维码识别 API
    qr_content = decode_qr_code_from_url(image_url)
    
    unless qr_content
      # 清除绑定状态
      @@pending_binding_photos.delete(message_id)
      error_message = "未能识别二维码，请重新对准二维码后再试。"
      stream_response(message_id, agent_id, error_message, {})
      send_done_event(message_id, agent_id)
      return
    end
    
    Rails.logger.info "[RokidSSE] QR code decoded: #{qr_content}"
    
    # 解析二维码内容：BOT_{id}
    if qr_content =~ /BOT_(\d+)/
      bot_id = $1.to_i
      bot = Bot.find_by(id: bot_id)
      
      unless bot
        @@pending_binding_photos.delete(message_id)
        error_message = "二维码无效，找不到对应的 Bot。"
        stream_response(message_id, agent_id, error_message, {})
        send_done_event(message_id, agent_id)
        return
      end
      
      # 检查是否已被其他 agent_id 绑定
      if bot.rokid_device_id.present? && bot.rokid_device_id != agent_id
        @@pending_binding_photos.delete(message_id)
        error_message = "此 Bot 已被其他设备绑定，请选择其他 Bot。"
        stream_response(message_id, agent_id, error_message, {})
        send_done_event(message_id, agent_id)
        return
      end
      
      # 绑定 agent_id 到 Bot
      if bot.update(rokid_device_id: agent_id)
        # 清除绑定状态
        @@pending_binding_photos.delete(message_id)
        Rails.logger.info "[RokidSSE] Successfully bound agent_id #{agent_id} to Bot #{bot.id}"
        success_message = "绑定成功！您现在可以使用 #{bot.name} 了。"
        stream_response(message_id, agent_id, success_message, {})
        send_done_event(message_id, agent_id)
      else
        @@pending_binding_photos.delete(message_id)
        error_message = "绑定失败，请稍后重试。"
        stream_response(message_id, agent_id, error_message, {})
        send_done_event(message_id, agent_id)
      end
    else
      @@pending_binding_photos.delete(message_id)
      error_message = "二维码格式不正确，请扫描网页上的绑定二维码。识别到的内容：#{qr_content}"
      stream_response(message_id, agent_id, error_message, {})
      send_done_event(message_id, agent_id)
    end
  end
  
  # 使用在线 API 解析二维码
  def decode_qr_code_from_url(image_url)
    require 'net/http'
    require 'uri'
    
    # 使用 api.2dcode.biz 的解码 API
    api_url = "https://api.2dcode.biz/v1/read-qr-code?file_url=#{CGI.escape(image_url)}"
    
    begin
      uri = URI.parse(api_url)
      response = Net::HTTP.get_response(uri)
      
      Rails.logger.info "[RokidSSE] QR decode API response code: #{response.code}"
      Rails.logger.info "[RokidSSE] QR decode API response body: #{response.body}"
      
      if response.is_a?(Net::HTTPSuccess)
        result = JSON.parse(response.body)
        # API 返回格式: {"code":0,"message":"ok","data":{"contents":["BOT_1"]}}
        if result['code'] == 0 && result['data'] && result['data']['contents'].is_a?(Array)
          return result['data']['contents'].first
        end
      end
    rescue StandardError => e
      Rails.logger.error "[RokidSSE] QR decode error: #{e.message}"
      Rails.logger.error e.backtrace.join("\n")
    end
    
    nil
  end

  # 提取最后一条用户消息内容
  def extract_last_user_message(messages)
    messages.reverse.each do |msg|
      next unless msg['role'] == 'user'
      
      case msg['type']
      when 'text'
        return msg['text'] if msg['text'].present?
      when 'image'
        return "[图片]"
      end
    end
    
    "未知消息"
  end

  # 流式输出响应
  def stream_response(message_id, agent_id, text, metadata)
    # 按字符流式输出（模拟真实 LLM 流式响应）
    chars = text.chars
    chars.each_with_index do |char, index|
      is_last = (index == chars.length - 1)
      
      event_data = {
        role: 'agent',
        type: 'answer',
        answer_stream: char,
        message_id: message_id,
        agent_id: agent_id,
        is_finish: false
      }
      
      write_sse_event('message', event_data)
      
      # 模拟打字延迟
      sleep 0.05
    end
    
    # 发送最后一个标记完成的消息
    final_data = {
      role: 'agent',
      type: 'answer',
      answer_stream: '',
      message_id: message_id,
      agent_id: agent_id,
      is_finish: true
    }
    
    write_sse_event('message', final_data)
    
  end

  # 发送完成事件
  def send_done_event(message_id, agent_id)
    done_data = {
      role: 'agent',
      type: 'answer',
      message_id: message_id,
      agent_id: agent_id,
      is_finish: true
    }
    
    write_sse_event('done', done_data)
  end

  # 发送拍照绑定请求
  def send_binding_photo_request(message_id, agent_id)
    # 先发送提示消息
    guide_text = "请将眼镜对准网页上的二维码，我来帮您拍照完成绑定。"
    stream_response(message_id, agent_id, guide_text, {})
    
    # 发送拍照指令
    Rails.logger.info "[RokidSSE] Sending take_photo command for binding"
    take_photo_data = {
      role: 'agent',
      type: 'tool_call',
      tool_call: {
        command: 'take_photo'
      },
      message_id: message_id,
      agent_id: agent_id,
      is_finish: false
    }
    write_sse_event('message', take_photo_data)
    
    # 发送完成事件
    send_done_event(message_id, agent_id)
  end

  # 发送错误事件
  def send_error_event(error_message)
    error_data = {
      role: 'agent',
      type: 'error',
      message: error_message,
      is_finish: true
    }
    
    write_sse_event('message', error_data)
    write_sse_event('done', error_data)
  end

  # 写入 SSE 事件
  def write_sse_event(event_name, data)
    return unless response.stream
    
    begin
      response.stream.write "event: #{event_name}\n"
      response.stream.write "data: #{data.to_json}\n\n"
    rescue IOError, Errno::EPIPE => e
      Rails.logger.info "[RokidSSE] Client disconnected: #{e.message}"
    end
  end

  # 检查 authenticate_user! 方法是否定义
  def authenticate_user_defined?
    respond_to?(:authenticate_user!, true)
  end
end

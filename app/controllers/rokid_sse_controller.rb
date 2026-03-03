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
    # 检查是否支持 Rack hijacking
    hijack_available = request.env['rack.hijack?']
    Rails.logger.info "[RokidSSE] Rack hijack available: #{hijack_available}"
    
    # 尝试使用 Rack hijacking 来直接控制 socket，绕过 ActionController::Live 的缓冲
    if hijack_available
      Rails.logger.info "[RokidSSE] Using hijack mode"
      sse_hijack
    else
      # Fallback: 使用 ActionController::Live（可能有缓冲问题）
      Rails.logger.info "[RokidSSE] Using ActionController::Live mode (fallback)"
      sse_live
    end
  end
  
  private
  
  # 使用 Rack hijacking 的 SSE 实现（真正的实时流式输出）
  def sse_hijack
    # Hijack the connection
    hijack_proc = request.env['rack.hijack']
    io = hijack_proc.call
    
    begin
      # 手动发送 HTTP 响应头
      io.write "HTTP/1.1 200 OK\r\n"
      io.write "Content-Type: text/event-stream\r\n"
      io.write "Cache-Control: no-cache\r\n"
      io.write "X-Accel-Buffering: no\r\n"
      io.write "Connection: keep-alive\r\n"
      io.write "\r\n"
      
      # 立即发送 SSE 注释来启动流式响应
      io.write ": connected\n\n"
      io.flush  # 关键：立即 flush 到网络
      
      # 解析请求参数
      request_data = JSON.parse(request.body.read)
      
      # 验证必填字段
      message_id = request_data['message_id']
      agent_id = request_data['agent_id']
      messages = request_data['message'] || []
      user_id = request_data['user_id']
      metadata = request_data['metadata'] || {}
      
      unless message_id && agent_id && messages.present?
        write_sse_event_direct(io, 'error', { message: 'Missing required parameters: message_id, agent_id, or message' })
        io.close
        return
      end
      
      # 验证全局 Access Key
      auth_token = extract_bearer_token
      unless auth_token
        write_sse_event_direct(io, 'error', { message: 'Missing Authorization header' })
        io.close
        return
      end
      
      access_key = AccessKey.find_and_touch(auth_token)
      unless access_key
        write_sse_event_direct(io, 'error', { message: 'Invalid or inactive Access Key' })
        io.close
        return
      end
      
      # 检查是否在等待绑定拍照的上下文中
      if @@pending_binding_photos[message_id] == agent_id
        image_message = extract_image_message(messages)
        if image_message && image_message['image_url'].present?
          Rails.logger.info "[RokidSSE] Received binding photo for message_id: #{message_id}"
          handle_binding_photo_result_hijack(io, message_id, agent_id, user_id, image_message['image_url'])
          return
        end
      end
      
      # 通过 user_id 查找绑定的 Bot
      # 这样每个用户的眼镜只能绑定到一个 Bot，防止盗用
      bot = Bot.find_by_rokid_user(user_id)
      
      # 生成 trace_id 用于追踪（在 bot 查找之后）
      trace_id = "trace_#{SecureRandom.hex(8)}"
      
      # 创建追踪记录（此时 bot 已找到）
      stream_trace = StreamTrace.create!(
        trace_id: trace_id,
        message_id: message_id,
        agent_id: agent_id,
        bot_id: bot&.id,
        status: 'active'
      )
      stream_trace.add_event(:request_received, {
        message_id: message_id,
        agent_id: agent_id,
        bot_id: bot&.id,
        access_key: access_key.name
      })
      
      Rails.logger.info "[RokidSSE] Created trace #{trace_id} for message_id=#{message_id}"
      
      unless bot
        Rails.logger.info "[RokidSSE] Bot not found for agent_id: #{agent_id}, sending take_photo command"
        @@pending_binding_photos[message_id] = agent_id
        send_binding_photo_request_hijack(io, message_id, agent_id)
        return
      end
      
      Rails.logger.info "[RokidSSE] Found bot: #{bot.name} (ID: #{bot.id})"
      
      # 检查 Bot 是否在线（通过 BotSession 的 last_ping_at）
      bot_session = BotSession.where(bot_id: bot.id).where('last_ping_at > ?', 5.minutes.ago).order(last_ping_at: :desc).first
      unless bot_session
        Rails.logger.warn "[RokidSSE] Bot #{bot.id} is offline (no active session)"
        error_message = "Bot 已离线，请检查设备连接后重试。"
        error_data = {
          role: 'agent',
          type: 'answer',
          answer_stream: error_message,
          message_id: message_id,
          agent_id: agent_id,
          is_finish: true
        }
        write_sse_event_direct(io, 'message', error_data)
        
        done_data = {
          role: 'agent',
          type: 'answer',
          message_id: message_id,
          agent_id: agent_id,
          is_finish: true
        }
        write_sse_event_direct(io, 'done', done_data)
        io.close
        return
      end
      
      Rails.logger.info "[RokidSSE] Bot #{bot.id} is online (last ping: #{bot_session.last_ping_at})"
      
      # 提取最后一条用户消息
      last_user_message = extract_last_user_message(messages)
      
      # 🔥 关键修复：在广播命令之前先订阅频道
      # 这样可以确保 SDK 发送的第一个 chunk 到达时，我们已经准备好接收
      
      subscription_channel = "rokid_sse_#{bot.id}_#{message_id}"
      cable = ActionCable.server.pubsub
      message_queue = Queue.new
      stream_finished = false
      
      callback = ->(data) {
        begin
          Rails.logger.info "[RokidSSE] Received broadcast on #{subscription_channel}"
          parsed_data = data.is_a?(String) ? JSON.parse(data) : data
          message_queue << parsed_data
          last_message_time = Time.current
        rescue => e
          Rails.logger.error "[RokidSSE] Error processing broadcast: #{e.message}"
        end
      }
      
      cable.subscribe(subscription_channel, callback)
      Rails.logger.info "[RokidSSE] ✅ Subscribed to channel: #{subscription_channel}"
      
      # 等待 50ms 让订阅生效（防止 ActionCable 内部延迟）
      sleep 0.05
      
      # 现在才广播命令
      # 通过 ActionCable 发送命令（带上 trace_id）
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
          session_id: message_id,
          openclaw_session_id: metadata['openclaw_session_id'] || "bot_#{bot.id}",
          trace_id: trace_id  # 添加 trace_id 用于追踪
        },
        timestamp: Time.current.iso8601
      }
      
      stream_trace.add_event(:command_broadcast, {
        channel: "bot_#{bot.id}_commands",
        timestamp: Time.current.iso8601
      })
      
      Rails.logger.info "[RokidSSE] 🚀 Broadcasting command to bot_#{bot.id}_commands (trace_id=#{trace_id})"
      ActionCable.server.broadcast("bot_#{bot.id}_commands", command_payload)
      
      # 订阅 ActionCable 频道以接收流式响应
      accumulated_content = ""
      streaming_active = false
      idle_timeout = 60
      last_message_time = Time.current
      
      # 用于按序号输出的状态
      next_expected_sequence = 0  # 下一个期望的序号
      pending_chunks = {}  # 缓存乱序到达的 chunks: {sequence => content}
      
      begin
        loop do
          if Time.current - last_message_time > idle_timeout
            Rails.logger.warn "[RokidSSE] Idle timeout: no response from Bot after #{idle_timeout} seconds"
            
            # 发送超时错误消息
            error_message = "请求超时，Bot 可能已离线或响应缓慢，请稍后重试。"
            error_data = {
              role: 'agent',
              type: 'answer',
              answer_stream: error_message,
              message_id: message_id,
              agent_id: agent_id,
              is_finish: true
            }
            write_sse_event_direct(io, 'message', error_data)
            
            done_data = {
              role: 'agent',
              type: 'answer',
              message_id: message_id,
              agent_id: agent_id,
              is_finish: true
            }
            write_sse_event_direct(io, 'done', done_data)
            break
          end
          
          begin
            data = message_queue.pop(true)
          rescue ThreadError
            sleep 0.1
            next
          end
          
          case data['type']
          when 'stream_chunk'
            content = data['content']
            sequence = data['sequence']  # SDK 发送的序号
            chunk_session_id = data['session_id']
            
            # 记录 SDK 收到的 chunk
            stream_trace.record_sdk_chunk(content, sequence) if stream_trace
            
            if chunk_session_id == message_id && content.present?
              Rails.logger.debug "[RokidSSE] Received stream chunk ##{sequence}: #{content[0..50]}"
              
              # 如果没有序号（旧版本 SDK），直接输出
              if sequence.nil?
                event_data = {
                  role: 'agent',
                  type: 'answer',
                  answer_stream: content,
                  message_id: message_id,
                  agent_id: agent_id,
                  is_finish: false
                }
                write_sse_event_direct(io, 'message', event_data)
                io.flush  # 确保立即发送到眼镜
                accumulated_content += content
                streaming_active = true
                
                # 记录 SSE 发送成功（无序号）
                stream_trace.record_sse_chunk(content, nil) if stream_trace
              else
                # 有序号，使用有序队列
                if sequence == next_expected_sequence
                  # 当前 chunk 是期望的，直接输出
                  event_data = {
                    role: 'agent',
                    type: 'answer',
                    answer_stream: content,
                    message_id: message_id,
                    agent_id: agent_id,
                    is_finish: false
                  }
                  write_sse_event_direct(io, 'message', event_data)
                  io.flush  # 确保立即发送到眼镜
                  accumulated_content += content
                  streaming_active = true
                  next_expected_sequence += 1
                  
                  # 记录 SSE 发送成功
                  stream_trace.record_sse_chunk(content, sequence) if stream_trace
                  
                  # 检查缓存中是否有后续的 chunks
                  while pending_chunks.key?(next_expected_sequence)
                    buffered_content = pending_chunks.delete(next_expected_sequence)
                    Rails.logger.debug "[RokidSSE] Outputting buffered chunk ##{next_expected_sequence}"
                    
                    event_data = {
                      role: 'agent',
                      type: 'answer',
                      answer_stream: buffered_content,
                      message_id: message_id,
                      agent_id: agent_id,
                      is_finish: false
                    }
                    write_sse_event_direct(io, 'message', event_data)
                    io.flush  # 确保立即发送到眼镜
                    accumulated_content += buffered_content
                    next_expected_sequence += 1
                    
                    # 记录 SSE 发送成功
                    stream_trace.record_sse_chunk(buffered_content, next_expected_sequence - 1) if stream_trace
                  end
                elsif sequence > next_expected_sequence
                  # 当前 chunk 来得太早，缓存起来
                  Rails.logger.debug "[RokidSSE] Buffering chunk ##{sequence} (expecting ##{next_expected_sequence})"
                  pending_chunks[sequence] = content
                else
                  # sequence < next_expected_sequence，说明是重复的，忽略
                  Rails.logger.warn "[RokidSSE] Ignoring duplicate chunk ##{sequence} (already processed)"
                end
              end
            end
            
          when 'stream_end'
            chunk_session_id = data['session_id']
            
            if chunk_session_id == message_id
              Rails.logger.info "[RokidSSE] Stream ended for session #{message_id}"
              streaming_active = false
              stream_finished = true
              
              # 记录 stream_end 事件
              stream_trace.add_event(:stream_end, {
                accumulated_content_length: accumulated_content.length,
                next_expected_sequence: next_expected_sequence
              }) if stream_trace
              
              final_data = {
                role: 'agent',
                type: 'answer',
                answer_stream: '',
                message_id: message_id,
                agent_id: agent_id,
                is_finish: true
              }
              write_sse_event_direct(io, 'message', final_data)
              io.flush
              
              done_data = {
                role: 'agent',
                type: 'answer',
                message_id: message_id,
                agent_id: agent_id,
                is_finish: true
              }
              write_sse_event_direct(io, 'done', done_data)
              io.flush
              break
            end
            
          # 新增：处理 SDK 发来的 stream_summary（兜底机制）
          when 'stream_summary'
            chunk_session_id = data['session_id']
            
            if chunk_session_id == message_id
              Rails.logger.info "[RokidSSE] Received stream_summary for session #{message_id}"
              
              sdk_total_content = data['total_content'] || ''
              sdk_total_chunks = data['total_chunks'] || 0
              content_hash = data['content_hash']
              
              stream_trace.add_event(:stream_summary_received, {
                sdk_total_chunks: sdk_total_chunks,
                sdk_total_content_length: sdk_total_content.length,
                sse_sent_chunks: stream_trace&.sse_chunk_count || 0,
                sse_sent_content_length: accumulated_content.length,
                content_hash: content_hash
              }) if stream_trace
              
              # 🔥 记录 SDK total_chunks
              stream_trace.update(sdk_total_chunks: sdk_total_chunks) if stream_trace
              
              # 检测丢包并尝试补偿
              if stream_trace
                diff = sdk_total_chunks - stream_trace.sse_chunk_count
                content_diff = sdk_total_content.length - accumulated_content.length
                
                Rails.logger.warn "[RokidSSE] [#{trace_id}] Compensation check: " \
                  "SDK chunks=#{sdk_total_chunks}, SSE sent=#{stream_trace.sse_chunk_count}, " \
                  "SDK len=#{sdk_total_content.length}, SSE len=#{accumulated_content.length}"
                
                # 如果有差异，尝试补偿发送缺失的内容
                if diff >= 3 || content_diff > 20
                  Rails.logger.warn "[RokidSSE] [#{trace_id}] Detected packet loss! Attempting compensation..."
                  
                  # 找出缺失的内容：SDK 完整内容 - 已发送内容
                  missing_content = sdk_total_content[accumulated_content.length..]
                  
                  if missing_content.present?
                    Rails.logger.info "[RokidSSE] [#{trace_id}] Sending compensation: #{missing_content.length} chars"
                    
                    # 发送补偿内容
                    compensation_data = {
                      role: 'agent',
                      type: 'answer',
                      answer_stream: missing_content,
                      message_id: message_id,
                      agent_id: agent_id,
                      is_finish: false
                    }
                    write_sse_event_direct(io, 'message', compensation_data)
                    io.flush
                    
                    # 更新已发送内容
                    accumulated_content += missing_content
                    
                    stream_trace.add_event(:compensation_sent, {
                      compensation_length: missing_content.length,
                      compensation_preview: missing_content[0..50]
                    })
                  end
                end
                
                # 更新追踪状态
                stream_trace.update(
                  status: (diff >= 3 || content_diff > 20) ? 'anomaly' : 'completed',
                  sdk_content: sdk_total_content,
                  sse_content: accumulated_content
                )
                
                # 🔥 检测异常并进行详细分析
                stream_trace.detect_anomaly!
              end
            end
            
          when 'stream_error'
            chunk_session_id = data['session_id']
            error = data['error']
            
            if chunk_session_id == message_id
              Rails.logger.error "[RokidSSE] Stream error: #{error}"
              write_sse_event_direct(io, 'error', { message: error })
              break
            end
          end
        end
      ensure
        # 最终更新追踪状态
        if stream_trace
          stream_trace.update(
            status: stream_finished ? 'completed' : stream_trace.status,
            sdk_content: stream_trace.sdk_content,
            sse_content: accumulated_content
          )
          stream_trace.detect_anomaly!
          Rails.logger.info "[RokidSSE] [#{trace_id}] Trace finalized: status=#{stream_trace.status}, SDK chunks=#{stream_trace.sdk_chunk_count}, SSE chunks=#{stream_trace.sse_chunk_count}"
        end
        
        cable.unsubscribe(subscription_channel, callback)
        Rails.logger.info "[RokidSSE] Unsubscribed from channel: #{subscription_channel}"
      end
      
      # 更新 bot session ping time
      update_bot_session_ping(bot.id)
      
    ensure
      io.close rescue nil
    end
  end
  
  # 使用 ActionController::Live 的 SSE 实现（Fallback）
  def sse_live
    # 设置 SSE 响应头
    response.headers['Content-Type'] = 'text/event-stream'
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['X-Accel-Buffering'] = 'no'
    response.headers['Connection'] = 'keep-alive'
    
    # 立即发送 headers 和一个 SSE 注释来启动流式响应
    # SSE 标准允许使用以冒号开头的行作为注释，客户端会忽略这些行
    response.stream.write ": connected\n\n"
    
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
      
      # 通过 user_id 查找绑定的 Bot
      # 这样每个用户的眼镜只能绑定到一个 Bot，防止盗用
      bot = Bot.find_by_rokid_user(user_id)
      
      # 如果未找到绑定的 Bot，发送拍照指令让用户扫描网页上的二维码
      unless bot
        Rails.logger.info "[RokidSSE] Bot not found for agent_id: #{agent_id}, sending take_photo command"
        # 记录此 message_id 正在等待绑定拍照
        @@pending_binding_photos[message_id] = agent_id
        send_binding_photo_request(message_id, agent_id)
        return
      end
      
      Rails.logger.info "[RokidSSE] Found bot: #{bot.name} (ID: #{bot.id})"
      
      # 检查 Bot 是否在线（通过 BotSession 的 last_ping_at）
      bot_session = BotSession.where(bot_id: bot.id).where('last_ping_at > ?', 5.minutes.ago).order(last_ping_at: :desc).first
      unless bot_session
        Rails.logger.warn "[RokidSSE] Bot #{bot.id} is offline (no active session)"
        error_message = "Bot 已离线，请检查设备连接后重试。"
        stream_response(message_id, agent_id, error_message, {})
        send_done_event(message_id, agent_id)
        return
      end
      
      Rails.logger.info "[RokidSSE] Bot #{bot.id} is online (last ping: #{bot_session.last_ping_at})"
      
      # 提取最后一条用户消息
      last_user_message = extract_last_user_message(messages)
      
      # 🔥 关键修复：在广播命令之前先订阅频道
      # 订阅 ActionCable 频道以接收流式响应
      stream_id = nil
      accumulated_content = ""
      streaming_active = false
      idle_timeout = 60  # 空闲超时：60秒内没有收到任何消息才超时
      last_message_time = Time.current
      
      # 用于按序号输出的状态
      next_expected_sequence = 0  # 下一个期望的序号
      pending_chunks = {}  # 缓存乱序到达的 chunks: {sequence => content}
      
      # 创建临时订阅以监听流式响应
      # BotChannel 广播到 rokid_sse_{bot_id}_{session_id} 频道
      subscription_channel = "rokid_sse_#{bot.id}_#{message_id}"
      
      # 使用 ActionCable 的内部订阅机制（Redis pubsub）
      cable = ActionCable.server.pubsub
      
      # 创建一个队列来接收消息
      message_queue = Queue.new
      stream_finished = false
      
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
      Rails.logger.info "[RokidSSE] ✅ Subscribed to channel: #{subscription_channel}"
      
      # 等待 50ms 让订阅生效
      sleep 0.05
      
      # 现在才广播命令
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
          session_id: message_id,  # 用于追踪响应
          openclaw_session_id: metadata['openclaw_session_id'] || "bot_#{bot.id}"
        },
        timestamp: Time.current.iso8601
      }
      
      Rails.logger.info "[RokidSSE] 🚀 Broadcasting command to bot_#{bot.id}_commands"
      Rails.logger.info "[RokidSSE] Command payload: #{command_payload.to_json[0..200]}"
      
      ActionCable.server.broadcast(
        "bot_#{bot.id}_commands",
        command_payload
      )
      
      Rails.logger.info "[RokidSSE] Broadcast completed, checking active subscriptions..."
      
      # 检查有多少客户端订阅了这个频道
      connections_count = ActionCable.server.connections.size
      Rails.logger.info "[RokidSSE] Active ActionCable connections: #{connections_count}"
      
      begin
        # 循环接收流式消息
        loop do
          # 检查空闲超时（只有在没有收到任何消息的情况下才超时）
          if Time.current - last_message_time > idle_timeout
            Rails.logger.warn "[RokidSSE] Idle timeout: no response from Bot after #{idle_timeout} seconds"
            
            # 发送超时错误消息
            error_message = "请求超时，Bot 可能已离线或响应缓慢，请稍后重试。"
            stream_response(message_id, agent_id, error_message, {})
            send_done_event(message_id, agent_id)
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
            # 新格式：{ type: 'stream_chunk', content: '...', sequence: X, session_id: '...' }
            content = data['content']
            sequence = data['sequence']  # SDK 发送的序号
            chunk_session_id = data['session_id']
            
            # 只处理匹配当前 message_id 的流式响应
            if chunk_session_id == message_id && content.present?
              Rails.logger.debug "[RokidSSE] Received stream chunk ##{sequence}: #{content[0..50]}"
              
              # 如果没有序号（旧版本 SDK），直接输出
              if sequence.nil?
                event_data = {
                  role: 'agent',
                  type: 'answer',
                  answer_stream: content,
                  message_id: message_id,
                  agent_id: agent_id,
                  is_finish: false
                }
                write_sse_event('message', event_data)
                accumulated_content += content
                streaming_active = true
              else
                # 有序号，使用有序队列
                if sequence == next_expected_sequence
                  # 当前 chunk 是期望的，直接输出
                  event_data = {
                    role: 'agent',
                    type: 'answer',
                    answer_stream: content,
                    message_id: message_id,
                    agent_id: agent_id,
                    is_finish: false
                  }
                  write_sse_event('message', event_data)
                  accumulated_content += content
                  streaming_active = true
                  next_expected_sequence += 1
                  
                  # 检查缓存中是否有后续的 chunks
                  while pending_chunks.key?(next_expected_sequence)
                    buffered_content = pending_chunks.delete(next_expected_sequence)
                    Rails.logger.debug "[RokidSSE] Outputting buffered chunk ##{next_expected_sequence}"
                    
                    event_data = {
                      role: 'agent',
                      type: 'answer',
                      answer_stream: buffered_content,
                      message_id: message_id,
                      agent_id: agent_id,
                      is_finish: false
                    }
                    write_sse_event('message', event_data)
                    accumulated_content += buffered_content
                    next_expected_sequence += 1
                  end
                elsif sequence > next_expected_sequence
                  # 当前 chunk 来得太早，缓存起来
                  Rails.logger.debug "[RokidSSE] Buffering chunk ##{sequence} (expecting ##{next_expected_sequence})"
                  pending_chunks[sequence] = content
                else
                  # sequence < next_expected_sequence，说明是重复的，忽略
                  Rails.logger.warn "[RokidSSE] Ignoring duplicate chunk ##{sequence} (already processed)"
                end
              end
            end
            
          when 'stream_end'
            # 流结束
            chunk_session_id = data['session_id']
            
            if chunk_session_id == message_id
              Rails.logger.info "[RokidSSE] Stream ended for session #{message_id}"
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
            end
            
          when 'stream_error'
            # 流错误
            chunk_session_id = data['session_id']
            error = data['error']
            
            if chunk_session_id == message_id
              Rails.logger.error "[RokidSSE] Stream error: #{error}"
              error_message = "处理出错：#{error}"
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
    
    # 验证令牌（替换原来的 BOT_{id} 解析）
    binding_token = BindingToken.find_by(token: qr_content)
    
    unless binding_token
      Rails.logger.error "[RokidSSE] ❌ Token not found: #{qr_content}"
      @@pending_binding_photos.delete(message_id)
      error_message = "无效的绑定令牌，请刷新网页后重新扫码。"
      stream_response(message_id, agent_id, error_message, {})
      send_done_event(message_id, agent_id)
      return
    end
    
    Rails.logger.info "[RokidSSE] ✅ Token found: #{binding_token.token}, bot_id: #{binding_token.bot_id}, expires_at: #{binding_token.expires_at}"
    
    # 检查令牌是否有效
    unless binding_token.valid_for_binding?
      Rails.logger.error "[RokidSSE] ❌ Token invalid: #{qr_content}, used_at: #{binding_token.used_at}, expires_at: #{binding_token.expires_at}, created_at: #{binding_token.created_at}"
      @@pending_binding_photos.delete(message_id)
      if binding_token.used_at.present?
        error_message = "此令牌已被使用，请刷新网页后重新扫码。"
      else
        error_message = "令牌已过期，请刷新网页后重新扫码。"
      end
      stream_response(message_id, agent_id, error_message, {})
      send_done_event(message_id, agent_id)
      return
    end
    
    Rails.logger.info "[RokidSSE] ✅ Token valid for binding"
    
    # 获取关联的 Bot
    bot = binding_token.bot
    Rails.logger.info "[RokidSSE] Processing binding for Bot #{bot.id} (#{bot.name}), current rokid_user_id: #{bot.rokid_user_id}, current rokid_device_id: #{bot.rokid_device_id}"
    
    # 预检查：用户是否已绑定到其他Bot
    existing_bot_by_user = Bot.find_by(rokid_user_id: user_id)
    if existing_bot_by_user && existing_bot_by_user.id != bot.id
      @@pending_binding_photos.delete(message_id)
      error_message = "您已绑定到其他Bot，请先在该Bot上解绑后再试。"
      stream_response(message_id, agent_id, error_message, {})
      send_done_event(message_id, agent_id)
      return
    end
    
    # 检查 Bot 是否已绑定其他用户（通过 user_id 判断）
    if bot.rokid_user_id.present? && bot.rokid_user_id != user_id
      Rails.logger.error "[RokidSSE] ❌ Binding rejected: Bot #{bot.id} already bound to user_id #{bot.rokid_user_id}, cannot bind to #{user_id}"
      @@pending_binding_photos.delete(message_id)
      error_message = "此 Bot 已被其他用户绑定，请先解绑后再试。"
      stream_response(message_id, agent_id, error_message, {})
      send_done_event(message_id, agent_id)
      return
    end
    
    Rails.logger.info "[RokidSSE] ✅ All prechecks passed, proceeding to bind Bot #{bot.id} to user_id #{user_id}, agent_id #{agent_id}"
    
    # 绑定 agent_id 和 user_id 到 Bot
    # 这样每个用户的眼镜只能绑定到一个 Bot
    begin
      if bot.update(rokid_device_id: agent_id, rokid_user_id: user_id)
        # 标记令牌为已使用
        binding_token.mark_as_used!(agent_id)
        
        # 清除绑定状态
        @@pending_binding_photos.delete(message_id)
        Rails.logger.info "[RokidSSE] ✅ Successfully bound agent_id #{agent_id} and user_id #{user_id} to Bot #{bot.id} (#{bot.name}) using token #{binding_token.token}"
        success_message = "绑定成功！您现在可以使用 #{bot.name} 了。"
        stream_response(message_id, agent_id, success_message, {})
        send_done_event(message_id, agent_id)
      else
        @@pending_binding_photos.delete(message_id)
        # 提供更详细的错误信息
        error_details = bot.errors.full_messages.join(', ')
        Rails.logger.error "[RokidSSE] ❌ Binding failed for Bot #{bot.id}: #{error_details}"
        Rails.logger.error "[RokidSSE] Bot validation errors: #{bot.errors.to_hash}"
        
        # 检查是否是唯一性冲突
        if bot.errors[:rokid_user_id].any?
          Rails.logger.error "[RokidSSE] Uniqueness conflict on rokid_user_id: #{user_id}"
          error_message = "绑定失败：您的灵珠账号已绑定到其他Bot，请先解绑后再试。"
        else
          error_message = "绑定失败，请稍后重试。"
        end
        stream_response(message_id, agent_id, error_message, {})
        send_done_event(message_id, agent_id)
      end
    rescue => e
      @@pending_binding_photos.delete(message_id)
      Rails.logger.error "[RokidSSE] ❌ Binding exception for Bot #{bot.id}: #{e.class.name} - #{e.message}"
      Rails.logger.error e.backtrace.join("\n")
      error_message = "绑定失败，请稍后重试。"
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
      
      # 支持没有 type 字段的标准消息格式（直接有 content 字段）
      return msg['content'] if msg['content'].present?
      
      # 支持带 type 字段的消息格式
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

  # 写入 SSE 事件（用于 hijacked socket）
  def write_sse_event_direct(io, event_name, data)
    return unless io
    
    start_time = Time.current
    begin
      timestamp_before = Time.current.strftime('%H:%M:%S.%3N')
      Rails.logger.info "[RokidSSE] ⏰ Writing #{event_name} at #{timestamp_before}"
      
      io.write "event: #{event_name}\n"
      io.write "data: #{data.to_json}\n\n"
      io.flush  # 关键：立即 flush 到网络
      
      timestamp_after_write = Time.current.strftime('%H:%M:%S.%3N')
      elapsed_ms = ((Time.current - start_time) * 1000).round(2)
      Rails.logger.info "[RokidSSE] ✅ Wrote+flushed #{event_name} in #{elapsed_ms}ms (at #{timestamp_after_write})"
    rescue IOError, Errno::EPIPE => e
      Rails.logger.info "[RokidSSE] Client disconnected: #{e.message}"
    end
  end
  
  # hijack 版本的 handle_binding_photo_result
  def handle_binding_photo_result_hijack(io, message_id, agent_id, user_id, image_url)
    Rails.logger.info "[RokidSSE] Processing binding photo result for agent_id: #{agent_id}"
    Rails.logger.info "[RokidSSE] Image URL: #{image_url}"
    
    # 调用二维码识别 API
    qr_content = decode_qr_code_from_url(image_url)
    
    unless qr_content
      # 清除绑定状态
      @@pending_binding_photos.delete(message_id)
      error_message = "未能识别二维码，请重新对准二维码后再试。"
      error_data = {
        role: 'agent',
        type: 'answer',
        answer_stream: error_message,
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'message', error_data)
      
      done_data = {
        role: 'agent',
        type: 'answer',
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'done', done_data)
      io.close
      return
    end
    
    Rails.logger.info "[RokidSSE] QR code decoded: #{qr_content}"
    
    # 验证令牌（替换原来的 BOT_{id} 解析）
    binding_token = BindingToken.find_by(token: qr_content)
    
    unless binding_token
      @@pending_binding_photos.delete(message_id)
      error_message = "无效的绑定令牌，请刷新网页后重新扫码。"
      error_data = {
        role: 'agent',
        type: 'answer',
        answer_stream: error_message,
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'message', error_data)
      
      done_data = {
        role: 'agent',
        type: 'answer',
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'done', done_data)
      io.close
      return
    end
    
    # 检查令牌是否有效
    unless binding_token.valid_for_binding?
      @@pending_binding_photos.delete(message_id)
      if binding_token.used_at.present?
        error_message = "此令牌已被使用，请刷新网页后重新扫码。"
      else
        error_message = "令牌已过期，请刷新网页后重新扫码。"
      end
      error_data = {
        role: 'agent',
        type: 'answer',
        answer_stream: error_message,
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'message', error_data)
      
      done_data = {
        role: 'agent',
        type: 'answer',
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'done', done_data)
      io.close
      return
    end
    
    # 获取关联的 Bot
    bot = binding_token.bot
    
    # 预检查：用户是否已绑定到其他Bot
    # agent_id 是灵珠平台分配的固定值，不作为唯一性约束
    # 只通过 user_id 来判断是否已绑定
    existing_bot_by_user = Bot.find_by(rokid_user_id: user_id)
    if existing_bot_by_user && existing_bot_by_user.id != bot.id
      Rails.logger.error "[RokidSSE] ❌ Binding rejected: user_id #{user_id} already bound to Bot #{existing_bot_by_user.id} (#{existing_bot_by_user.name})"
      @@pending_binding_photos.delete(message_id)
      error_message = "您的灵珠账号已绑定到 Bot「#{existing_bot_by_user.name}」，请先解绑后再试。"
      error_data = {
        role: 'agent',
        type: 'answer',
        answer_stream: error_message,
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'message', error_data)
      
      done_data = {
        role: 'agent',
        type: 'answer',
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'done', done_data)
      io.close
      return
    end
    
    Rails.logger.info "[RokidSSE] ✅ Precheck passed: user_id #{user_id} not bound to other bots"
    
    # 检查 Bot 是否已绑定其他用户（通过 user_id 判断）
    if bot.rokid_user_id.present? && bot.rokid_user_id != user_id
      Rails.logger.error "[RokidSSE] ❌ Binding rejected: Bot #{bot.id} already bound to user_id #{bot.rokid_user_id}, cannot bind to #{user_id}"
      @@pending_binding_photos.delete(message_id)
      error_message = "此 Bot 已被其他用户绑定，请先解绑后再试。"
      error_data = {
        role: 'agent',
        type: 'answer',
        answer_stream: error_message,
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'message', error_data)
      
      done_data = {
        role: 'agent',
        type: 'answer',
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'done', done_data)
      io.close
      return
    end
    
    Rails.logger.info "[RokidSSE] ✅ All prechecks passed, proceeding to bind Bot #{bot.id} to user_id #{user_id}, agent_id #{agent_id}"
    
    # 绑定 agent_id 和 user_id 到 Bot
    # 这样每个用户的眼镜只能绑定到一个 Bot
    begin
      if bot.update(rokid_device_id: agent_id, rokid_user_id: user_id)
        # 标记令牌为已使用
        binding_token.mark_as_used!(agent_id)
        
        # 清除绑定状态
        @@pending_binding_photos.delete(message_id)
        Rails.logger.info "[RokidSSE] ✅ Successfully bound agent_id #{agent_id} and user_id #{user_id} to Bot #{bot.id} (#{bot.name}) using token #{binding_token.token}"
        success_message = "绑定成功！您现在可以使用 #{bot.name} 了。请刷新页面查看绑定状态。"
        success_data = {
          role: 'agent',
          type: 'answer',
          answer_stream: success_message,
          message_id: message_id,
          agent_id: agent_id,
          is_finish: true
        }
        write_sse_event_direct(io, 'message', success_data)
        
        done_data = {
          role: 'agent',
          type: 'answer',
          message_id: message_id,
          agent_id: agent_id,
          is_finish: true
        }
        write_sse_event_direct(io, 'done', done_data)
      else
        @@pending_binding_photos.delete(message_id)
        # 提供更详细的错误信息
        error_details = bot.errors.full_messages.join(', ')
        Rails.logger.error "[RokidSSE] ❌ Binding failed for Bot #{bot.id}: #{error_details}"
        Rails.logger.error "[RokidSSE] Bot validation errors: #{bot.errors.to_hash}"
        
        # 检查是否是唯一性冲突
        if bot.errors[:rokid_user_id].any?
          Rails.logger.error "[RokidSSE] Uniqueness conflict on rokid_user_id: #{user_id}"
          error_message = "绑定失败：您的灵珠账号已绑定到其他Bot，请先解绑后再试。"
        else
          error_message = "绑定失败，请稍后重试。"
        end
        error_data = {
          role: 'agent',
          type: 'answer',
          answer_stream: error_message,
          message_id: message_id,
          agent_id: agent_id,
          is_finish: true
        }
        write_sse_event_direct(io, 'message', error_data)
        
        done_data = {
          role: 'agent',
          type: 'answer',
          message_id: message_id,
          agent_id: agent_id,
          is_finish: true
        }
        write_sse_event_direct(io, 'done', done_data)
      end
    rescue => e
      @@pending_binding_photos.delete(message_id)
      Rails.logger.error "[RokidSSE] ❌ Binding exception for Bot #{bot.id}: #{e.class.name} - #{e.message}"
      Rails.logger.error e.backtrace.join("\n")
      error_message = "绑定失败，请稍后重试。"
      error_data = {
        role: 'agent',
        type: 'answer',
        answer_stream: error_message,
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'message', error_data)
      
      done_data = {
        role: 'agent',
        type: 'answer',
        message_id: message_id,
        agent_id: agent_id,
        is_finish: true
      }
      write_sse_event_direct(io, 'done', done_data)
    end
    
    io.close
  end
  
  # hijack 版本的 send_binding_photo_request
  def send_binding_photo_request_hijack(io, message_id, agent_id)
    instructions_data = {
      role: 'agent',
      type: 'answer',
      answer_stream: '你好！请先在 https://eyeclaw.com/ 网站上创建或打开机器人页面，查看绑定二维码，然后使用眼镜拍摄二维码完成绑定。',
      message_id: message_id,
      agent_id: agent_id,
      is_finish: false
    }
    write_sse_event_direct(io, 'message', instructions_data)
    
    # 发送拍照指令
    Rails.logger.info "[RokidSSE] Sending take_photo command for binding in hijack mode"
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
    write_sse_event_direct(io, 'message', take_photo_data)
    
    end_data = {
      role: 'agent',
      type: 'answer',
      answer_stream: '',
      message_id: message_id,
      agent_id: agent_id,
      is_finish: true
    }
    write_sse_event_direct(io, 'message', end_data)
    
    done_data = {
      role: 'agent',
      type: 'answer',
      message_id: message_id,
      agent_id: agent_id,
      is_finish: true
    }
    write_sse_event_direct(io, 'done', done_data)
    io.close
  end
  
  # 更新 bot session ping time
  def update_bot_session_ping(bot_id)
    bot_session = BotSession.where(bot_id: bot_id).where('last_ping_at > ?', 5.minutes.ago).order(last_ping_at: :desc).first
    if bot_session
      bot_session.update(last_ping_at: Time.current)
    end
  end

  # 写入 SSE 事件
  def write_sse_event(event_name, data)
    return unless response.stream
    
    start_time = Time.current
    begin
      timestamp_before = Time.current.strftime('%H:%M:%S.%3N')
      Rails.logger.info "[RokidSSE] ⏰ Writing #{event_name} at #{timestamp_before}"
      
      response.stream.write "event: #{event_name}\n"
      response.stream.write "data: #{data.to_json}\n\n"
      
      timestamp_after_write = Time.current.strftime('%H:%M:%S.%3N')
      elapsed_ms = ((Time.current - start_time) * 1000).round(2)
      Rails.logger.info "[RokidSSE] ✍️  Wrote #{event_name}, elapsed: #{elapsed_ms}ms (at #{timestamp_after_write})"
      
      # 关键：调用 response.commit! 强制将响应 flush 到客户端
      # 这会立即将当前写入的数据发送到网络，不会等待缓冲区填满
      unless response.committed?
        response.commit!
        Rails.logger.info "[RokidSSE] 💧 Committed response (forced flush to client)"
      else
        Rails.logger.info "[RokidSSE] ℹ️  Response already committed"
      end
      
      total_elapsed_ms = ((Time.current - start_time) * 1000).round(2)
      Rails.logger.info "[RokidSSE] ✅ Completed write+commit in #{total_elapsed_ms}ms"
    rescue IOError, Errno::EPIPE => e
      Rails.logger.info "[RokidSSE] Client disconnected: #{e.message}"
    end
  end

  # 检查 authenticate_user! 方法是否定义
  def authenticate_user_defined?
    respond_to?(:authenticate_user!, true)
  end
end

/**
 * EyeClaw SDK - WebSocket Client
 * 
 * 连接到 Rails 服务器，接收消息并流式返回
 */
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import type { EyeClawConfig } from './types.js'

interface WebSocketMessage {
  type: string
  [key: string]: any
}

interface ActionCableMessage {
  identifier: string
  message: WebSocketMessage
}

export class EyeClawWebSocketClient {
  private ws: WebSocket | null = null
  private api: OpenClawPluginApi
  private config: EyeClawConfig
  private getState: () => any
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private baseReconnectDelay = 1000 // 1 second
  private maxReconnectDelay = 30000 // 30 seconds
  private currentReconnectDelay = 1000
  private reconnecting = false
  private subscribed = false
  private pingInterval: any = null
  private chunkSequence = 0 // 每个会话的 chunk 序号
  private accumulatedContent = '' // 累积完整内容用于兜底

  constructor(api: OpenClawPluginApi, config: EyeClawConfig, getState: () => any) {
    this.api = api
    this.config = config
    this.getState = getState
  }

  /**
   * 启动 WebSocket 连接
   */
  async start() {
    const { serverUrl, sdkToken, botId } = this.config
    
    if (!serverUrl || !sdkToken || !botId) {
      this.api.logger.warn('[EyeClaw] WebSocket: Missing config (serverUrl, sdkToken, or botId)')
      return
    }

    const wsUrl = serverUrl.replace(/^http/, 'ws') + `/cable?sdk_token=${sdkToken}&bot_id=${botId}`
    this.api.logger.info(`[EyeClaw] WebSocket connecting to: ${wsUrl}`)

    try {
      // @ts-ignore - WebSocket 在 Node 环境中可用
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        this.api.logger.info('[EyeClaw] WebSocket connected')
        this.reconnectAttempts = 0
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onerror = (error) => {
        this.api.logger.error(`[EyeClaw] WebSocket error: ${error}`)
      }

      this.ws.onclose = () => {
        this.api.logger.warn('[EyeClaw] WebSocket disconnected')
        this.subscribed = false
        this.stopPing()
        this.scheduleReconnect()
      }

    } catch (error) {
      this.api.logger.error(`[EyeClaw] WebSocket connection failed: ${error}`)
      this.scheduleReconnect()
    }
  }

  /**
   * 停止 WebSocket 连接
   */
  stop() {
    this.stopPing()
    this.reconnecting = false
    this.resetReconnectDelay()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.subscribed = false
  }

  /**
   * 重置重连延迟
   */
  private resetReconnectDelay() {
    this.currentReconnectDelay = this.baseReconnectDelay
    this.reconnectAttempts = 0
  }

  /**
   * 计算下一次重连延迟（指数退避 + 随机抖动）
   */
  private calculateReconnectDelay(): number {
    // 指数增长: 1s, 2s, 4s, 8s, 16s, 30s (cap)
    const delay = Math.min(
      this.currentReconnectDelay * 2,
      this.maxReconnectDelay
    )
    this.currentReconnectDelay = delay
    
    // 添加随机抖动 (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1)
    return Math.floor(delay + jitter)
  }

  /**
   * 处理 WebSocket 消息
   */
  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data)

      // Welcome message
      if (message.type === 'welcome') {
        this.api.logger.info('[EyeClaw] Received welcome, subscribing...')
        this.subscribe()
        return
      }

      // Ping/pong (WebSocket 协议级别的 ping 由浏览器自动响应，无需手动处理)
      if (message.type === 'ping') {
        this.api.logger.debug('[EyeClaw] Received protocol-level ping (auto-handled by WebSocket)')
        return
      }
      
      // 处理 Rails BotChannel 的 pong 响应
      if (message.type === 'pong') {
        this.api.logger.debug('[EyeClaw] Received pong from server')
        return
      }

      // Subscription confirmation
      if (message.type === 'confirm_subscription') {
        this.api.logger.info('[EyeClaw] ✅ Subscribed to channel')
        this.subscribed = true
        this.startPing()
        return
      }

      // Rejection
      if (message.type === 'reject_subscription') {
        this.api.logger.error('[EyeClaw] ❌ Subscription rejected')
        return
      }

      // 实际消息 - 从 Rails 发送的消息
      if (message.identifier && message.message) {
        const payload = message.message
        this.handleCommand(payload)
      }

    } catch (error) {
      this.api.logger.error(`[EyeClaw] Failed to parse message: ${error}`)
    }
  }

  /**
   * 订阅到 BotChannel
   */
  private subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const channelIdentifier = JSON.stringify({
      channel: 'BotChannel',
      bot_id: this.config.botId,
    })

    this.send({
      command: 'subscribe',
      identifier: channelIdentifier,
    })
  }

  /**
   * 处理命令消息
   */
  private async handleCommand(payload: WebSocketMessage) {
    const { type, params, metadata, command } = payload

    // 只处理 execute_command 类型的消息
    if (type !== 'execute_command' && type !== 'chat') {
      return
    }
    
    // 从 params.message 或 command 提取用户消息
    const userMessage = params?.message || command
    if (!userMessage) {
      this.api.logger.warn('[EyeClaw] No message content')
      return
    }
    
    // 从 metadata 提取 session_id (用于 Rails 内部追踪)
    const sessionId = metadata?.session_id
    
    // 从 metadata 提取 openclaw_session_id (用于 OpenClaw 对话上下文)
    // 如果未指定，使用 bot_id 作为默认值，这样同一个 Bot 的所有请求共享上下文
    const openclawSessionId = metadata?.openclaw_session_id || `bot_${this.config.botId}`
    
    this.api.logger.info(`[EyeClaw] Processing: ${userMessage.substring(0, 50)}...`)
    this.api.logger.info(`[EyeClaw] Rails Session ID: ${sessionId}`)
    this.api.logger.info(`[EyeClaw] OpenClaw Session ID: ${openclawSessionId}`)

    // 通过 OpenClaw API 处理消息，获取流式响应
    await this.processWithOpenClaw(userMessage, sessionId, openclawSessionId)
  }

  /**
   * 使用 OpenClaw API 处理消息（流式）
   * 调用自己的 HTTP 端点 /eyeclaw/chat
   */
  private async processWithOpenClaw(message: string, sessionId?: string, openclawSessionId?: string) {
    // 重置 chunk 序号（每个新会话）
    this.chunkSequence = 0
    
    const state = this.getState()
    const gatewayPort = state.gatewayPort
    const eyeclawUrl = `http://127.0.0.1:${gatewayPort}/eyeclaw/chat`
    
    const requestBody = {
      message,
      session_id: sessionId,
      openclaw_session_id: openclawSessionId,
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.sdkToken}`,
    }

    this.api.logger.info(`[EyeClaw] Calling own HTTP endpoint: ${eyeclawUrl}`)

    try {
      const response = await fetch(eyeclawUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      })

      this.api.logger.info(`[EyeClaw] HTTP response status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text()
        this.api.logger.error(`[EyeClaw] HTTP error: status=${response.status}, body=${errorText}`)
        throw new Error(`HTTP error: ${response.status} - ${errorText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''

      // 解析 SSE 流式响应
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // 流结束，通知 Rails
          this.sendMessage('stream_end', { session_id: sessionId })
          
          // 发送 stream_summary 用于兜底机制
          this.sendStreamSummary(sessionId)
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          
          // 跳过空行和注释
          if (!trimmed || trimmed.startsWith(':')) {
            // 空行表示事件结束，重置 currentEvent
            if (!trimmed) {
              currentEvent = ''
            }
            continue
          }
          
          // 解析 SSE 事件类型
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7).trim()
            continue
          }
          
          // 解析 SSE 数据
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6)
            
            try {
              const eventData = JSON.parse(data)
              
              // stream_chunk 事件：发送内容
              if (currentEvent === 'stream_chunk' && eventData.content) {
                this.sendChunk(eventData.content, sessionId)
              }
              
              // stream_end 事件：流结束（由 HTTP handler 发送）
              if (currentEvent === 'stream_end') {
                this.api.logger.info(`[EyeClaw] Stream ended: ${eventData.stream_id}`)
                // 通知 Rails 流已结束
                this.sendMessage('stream_end', { session_id: sessionId })
              }
              
              // stream_error 事件：错误
              if (currentEvent === 'stream_error') {
                this.api.logger.error(`[EyeClaw] Stream error: ${eventData.error}`)
              }
            } catch (e) {
              this.api.logger.warn(`[EyeClaw] Failed to parse SSE data: ${data}`)
            }
          }
        }
      }

      this.api.logger.info(`[EyeClaw] Stream processing completed for session: ${sessionId}`)

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.api.logger.error(`[EyeClaw] OpenClaw error: ${errorMsg}`)
      this.sendMessage('stream_error', { error: errorMsg, session_id: sessionId })
    }
  }

  /**
   * 通过 WebSocket 发送消息到 Rails
   */
  private send(data: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(data))
  }

  /**
   * 发送流式内容块到 Rails
   */
  private sendChunk(content: string, sessionId?: string) {
    const timestamp = new Date().toISOString();
    const sequence = this.chunkSequence++;
    
    // 累积完整内容用于兜底
    this.accumulatedContent += content;
    
    this.api.logger.info(`[EyeClaw] [${timestamp}] Sending chunk #${sequence} to Rails: "${content}"`);
    this.sendMessage('stream_chunk', {
      content,
      session_id: sessionId,
      sequence, // 添加序号
    })
  }
  
  /**
   * 发送 stream_summary 用于兜底机制
   * 告诉 Rails 完整内容是什么，以便检测丢包并补偿
   */
  private sendStreamSummary(sessionId?: string) {
    // 计算内容 hash
    const contentHash = this.hashCode(this.accumulatedContent);
    
    this.api.logger.info(`[EyeClaw] Sending stream_summary: chunks=${this.chunkSequence}, content_len=${this.accumulatedContent.length}, hash=${contentHash}`);
    
    this.sendMessage('stream_summary', {
      session_id: sessionId,
      total_content: this.accumulatedContent,
      total_chunks: this.chunkSequence,
      content_hash: contentHash,
    })
    
    // 重置累积内容（为下一个会话做准备）
    this.accumulatedContent = '';
    this.chunkSequence = 0;
  }
  
  /**
   * 简单 hash 函数
   */
  private hashCode(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  /**
   * 发送消息到 Rails（带 channel identifier）
   */
  private sendMessage(type: string, data: any) {
    const channelIdentifier = JSON.stringify({
      channel: 'BotChannel',
      bot_id: this.config.botId,
    })

    this.send({
      command: 'message',
      identifier: channelIdentifier,
      data: JSON.stringify({ type, ...data }),
    })
  }

  /**
   * 启动心跳
   */
  private startPing() {
    this.pingInterval = setInterval(() => {
      // 调用 Rails BotChannel 的 ping 方法（使用 ActionCable 标准协议）
      const channelIdentifier = JSON.stringify({
        channel: 'BotChannel',
        bot_id: this.config.botId,
      })
      
      this.send({
        command: 'message',
        identifier: channelIdentifier,
        data: JSON.stringify({
          action: 'ping',
          timestamp: new Date().toISOString(),
        }),
      })
    }, 60000) // 60秒心跳一次
  }

  /**
   * 停止心跳
   */
  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  /**
   * 计划重连（带指数退避）
   */
  private scheduleReconnect() {
    // 防止重复调度
    if (this.reconnecting) {
      return
    }
    this.reconnecting = true
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.api.logger.error('[EyeClaw] Max reconnect attempts reached, will retry later...')
      // 不放弃，继续重试（每 60 秒检查一次）
      setTimeout(() => {
        this.reconnecting = false
        this.resetReconnectDelay()
        this.scheduleReconnect()
      }, 60000)
      return
    }

    const delay = this.calculateReconnectDelay()
    this.reconnectAttempts++
    this.api.logger.info(`[EyeClaw] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    setTimeout(() => {
      this.reconnecting = false
      this.start()
    }, delay)
  }
}

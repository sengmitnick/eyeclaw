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
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 3000
  private subscribed = false
  private pingInterval: any = null

  constructor(api: OpenClawPluginApi, config: EyeClawConfig) {
    this.api = api
    this.config = config
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
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.subscribed = false
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

      // Ping/pong
      if (message.type === 'ping') {
        this.send({ type: 'pong' })
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
    const { type, message: text, session_id, command } = payload

    // 只处理 execute_command 类型的消息
    if (type !== 'execute_command' && type !== 'chat') {
      return
    }

    const userMessage = text || command
    if (!userMessage) {
      this.api.logger.warn('[EyeClaw] No message content')
      return
    }

    this.api.logger.info(`[EyeClaw] Processing: ${userMessage.substring(0, 50)}...`)

    // 通过 OpenClaw API 处理消息，获取流式响应
    await this.processWithOpenClaw(userMessage, session_id)
  }

  /**
   * 使用 OpenClaw API 处理消息（流式）
   */
  private async processWithOpenClaw(message: string, sessionId?: string) {
    const gatewayPort = this.api.config?.gateway?.port ?? 18789
    const gatewayToken = this.api.config?.gateway?.auth?.token

    const openclawUrl = `http://127.0.0.1:${gatewayPort}/v1/chat/completions`
    const openclawBody = {
      model: 'openclaw:main',
      stream: true,
      messages: [{ role: 'user', content: message }],
      user: sessionId ? `eyeclaw:${sessionId}` : 'eyeclaw:ws',
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (gatewayToken) headers['Authorization'] = `Bearer ${gatewayToken}`

    try {
      const response = await fetch(openclawUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(openclawBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenClaw API error: ${response.status} - ${errorText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      // 发送流式响应回 Rails
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') continue

          try {
            const chunk = JSON.parse(data)
            const content = chunk.choices?.[0]?.delta?.content
            if (content) {
              this.sendChunk(content, sessionId)
            }
          } catch { /* ignore */ }
        }
      }

      // 发送完成信号
      this.sendMessage('stream_end', { session_id: sessionId })

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
    this.send({
      type: 'stream_chunk',
      content,
      session_id: sessionId,
    })
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
      data: { type, ...data },
    })
  }

  /**
   * 启动心跳
   */
  private startPing() {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' })
    }, 30000)
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
   * 计划重连
   */
  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.api.logger.error('[EyeClaw] Max reconnect attempts reached')
      return
    }

    this.reconnectAttempts++
    this.api.logger.info(`[EyeClaw] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts})`)

    setTimeout(() => {
      this.start()
    }, this.reconnectDelay)
  }
}

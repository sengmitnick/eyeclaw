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
  private connectionHealthCheckTimer: any = null
  private chunkSequence = 0 // 每个会话的 chunk 序号
  private accumulatedContent = '' // 累积完整内容用于兜底
  private lastConnectedAt = 0 // 上次连接成功时间戳
  private deploymentDetected = false // 是否检测到部署重启
  private wasConnected = false // 之前是否连接成功过
  private reconnectTimer: any = null // 重连定时器引用
  private serverVersion = '' // 服务器版本（用于检测部署）
  private consecutiveFailures = 0 // 连续失败次数
  private lastCloseCode = 0 // 上次关闭码
  
  // 🔥 ACK 机制：追踪已发送和已确认的 chunks
  private sentChunks = 0 // 已发送的 chunks 数量
  private ackedChunks = new Set<number>() // 已确认的 chunk 序号集合

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
        this.consecutiveFailures = 0 // 重置连续失败计数
        this.lastConnectedAt = Date.now()
        this.wasConnected = true
        
        // 如果检测到部署重启（之前已连接过），立即触发一次快速心跳
        if (this.deploymentDetected) {
          this.api.logger.info('[EyeClaw] 🚀 Deployment recovery detected, sending immediate ping')
          this.deploymentDetected = false
          // 延迟 500ms 确保订阅完成后再发心跳
          setTimeout(() => this.sendPing(), 500)
        }
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onerror = (error) => {
        this.api.logger.error(`[EyeClaw] WebSocket error: ${error}`)
      }

      this.ws.onclose = () => {
        const closeCode = this.ws?.closeCode || 0
        const wasClean = closeCode === 1000 || closeCode === 1001
        
        this.api.logger.warn(`[EyeClaw] WebSocket closed (code: ${closeCode}, clean: ${wasClean})`)
        
        this.subscribed = false
        this.stopPing()
        this.lastCloseCode = closeCode
        
        // 统计连续失败
        this.consecutiveFailures++
        
        // 检测是否是部署导致的断连（之前已成功连接过，且断开时间 > 5 秒）
        // 或者关闭码为 1000/1001（正常关闭）但之前已连接
        if (this.wasConnected && Date.now() - this.lastConnectedAt > 5000) {
          // 正常关闭或部署重启
          if (wasClean) {
            this.deploymentDetected = true
            this.api.logger.info('[EyeClaw] 🔄 Deployment or clean close detected, will reconnect immediately')
          } else {
            // 非正常关闭但之前已连接，很可能是服务器重启
            this.deploymentDetected = true
            this.api.logger.info('[EyeClaw] 🔄 Server restart detected (unclean close), will reconnect immediately')
          }
        } else if (!this.wasConnected && !wasClean) {
          // 首次连接失败，增加重试延迟
          this.api.logger.warn('[EyeClaw] Initial connection failed, increasing delay...')
        }
        
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
    
    // 清理所有定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // 注意：不再需要清理 healthCheckInterval，因为已合并到 connectionHealthCheckTimer
    
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.subscribed = false
    this.wasConnected = false
  }

  /**
   * 重置重连延迟
   */
  private resetReconnectDelay() {
    this.currentReconnectDelay = this.baseReconnectDelay
    this.reconnectAttempts = 0
    // 注意：不重置 consecutiveFailures，因为这是跨会话的统计
  }

  /**
   * 计算下一次重连延迟（指数退避 + 随机抖动 + 智能调整）
   */
  private calculateReconnectDelay(): number {
    // 基础延迟：1s, 2s, 4s, 8s, 16s, 30s (cap)
    let delay = Math.min(
      this.currentReconnectDelay * 2,
      this.maxReconnectDelay
    )
    this.currentReconnectDelay = delay
    
    // 如果连续失败多次，增加额外延迟
    if (this.consecutiveFailures > 3) {
      delay = Math.min(delay * 1.5, this.maxReconnectDelay)
    }
    
    // 如果上次关闭码不是正常关闭（1000/1001），增加延迟
    if (this.lastCloseCode !== 0 && this.lastCloseCode !== 1000 && this.lastCloseCode !== 1001) {
      delay = Math.min(delay * 1.5, this.maxReconnectDelay)
    }
    
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
        this.api.logger?.debug?.('[EyeClaw] Received protocol-level ping (auto-handled by WebSocket)')
        return
      }
      
      // 处理 Rails BotChannel 的 pong 响应
      if (message.type === 'pong') {
        this.api.logger?.debug?.('[EyeClaw] Received pong from server')
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
        
        // 🔥 ACK 机制：处理 chunk_received 确认
        if (payload.type === 'chunk_received') {
          const sequence = payload.sequence
          this.ackedChunks.add(sequence)
          this.api.logger?.debug?.(`[EyeClaw] ✅ Received ACK for chunk #${sequence}, total acked: ${this.ackedChunks.size}/${this.sentChunks}`)
          return
        }
        
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
    // 重置 chunk 序号和 ACK 计数器（每个新会话）
    this.chunkSequence = 0
    this.sentChunks = 0
    this.ackedChunks.clear()
    
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
      let streamEnded = false
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          this.api.logger.info(`[EyeClaw] Reader done, stream ended flag: ${streamEnded}`)
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
                this.api.logger.info(`[EyeClaw] Received stream_end event: ${eventData.stream_id}`)
                streamEnded = true
                
                // 🔥 等待所有 chunks 被确认后再发送 stream_end
                await this.waitForAllAcks(sessionId)
                
                // 发送 stream_end 和 stream_summary
                this.sendMessage('stream_end', { session_id: sessionId })
                this.sendStreamSummary(sessionId)
                
                // 退出循环
                return
              }
              
              // stream_error 事件：错误
              if (currentEvent === 'stream_error') {
                this.api.logger.error(`[EyeClaw] Stream error: ${eventData.error}`)
                this.sendMessage('stream_error', { error: eventData.error, session_id: sessionId })
                return
              }
            } catch (e) {
              this.api.logger.warn(`[EyeClaw] Failed to parse SSE data: ${data}`)
            }
          }
        }
      }
      
      // 如果循环正常结束（没有收到 stream_end 事件），也要等待 ACK
      if (!streamEnded) {
        this.api.logger.info(`[EyeClaw] Stream ended without stream_end event, waiting for ACKs`)
        await this.waitForAllAcks(sessionId)
        this.sendMessage('stream_end', { session_id: sessionId })
        this.sendStreamSummary(sessionId)
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
    this.sentChunks++; // 🔥 记录已发送数量
    
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
   * 🔥 等待所有 chunks 被 Rails 确认
   * 实现 TCP 三次握手的应用层版本
   * 超时 2 秒后强制返回，依赖 stream_summary 兜底机制
   */
  private async waitForAllAcks(sessionId?: string): Promise<void> {
    const startTime = Date.now()
    const timeout = 2000 // 2秒超时
    const checkInterval = 50 // 每 50ms 检查一次
    
    this.api.logger.info(`[EyeClaw] 🕒 Waiting for all ACKs: sent=${this.sentChunks}, acked=${this.ackedChunks.size}`)
    
    while (this.ackedChunks.size < this.sentChunks) {
      const elapsed = Date.now() - startTime
      
      if (elapsed >= timeout) {
        const missing = this.sentChunks - this.ackedChunks.size
        const missingSequences: number[] = []
        for (let i = 0; i < this.sentChunks; i++) {
          if (!this.ackedChunks.has(i)) {
            missingSequences.push(i)
          }
        }
        
        this.api.logger.warn(
          `[EyeClaw] ⚠️ ACK timeout after ${elapsed}ms: ` +
          `sent=${this.sentChunks}, acked=${this.ackedChunks.size}, ` +
          `missing=${missing}, missing_sequences=[${missingSequences.join(', ')}]`
        )
        this.api.logger.info(`[EyeClaw] Relying on stream_summary fallback mechanism`)
        break
      }
      
      // 等待 50ms 后再检查
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }
    
    if (this.ackedChunks.size === this.sentChunks) {
      const elapsed = Date.now() - startTime
      this.api.logger.info(
        `[EyeClaw] ✅ All chunks ACKed: ${this.ackedChunks.size}/${this.sentChunks} in ${elapsed}ms`
      )
    }
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
   * 心跳间隔设置为 30 秒，比负载均衡器的超时时间短
   */
  private startPing() {
    this.stopPing() // 先清理旧的心跳定时器
    
    // 主心跳：每 30 秒发送一次（比负载均衡器超时短）
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
      
      this.api.logger?.debug?.('[EyeClaw] 🔔 Heartbeat sent')
    }, 30000) // 30 秒心跳 - 适合负载均衡器
    
    // 连接健康检查：每 10 秒检查一次 WebSocket 状态
    this.connectionHealthCheckTimer = setInterval(() => {
      this.checkConnectionHealth()
    }, 10000)
  }

  /**
   * 检查 WebSocket 连接健康状态
   * 如果连接异常，自动触发重连
   */
  private checkConnectionHealth() {
    if (!this.ws) {
      this.api.logger?.warn?.('[EyeClaw] ⚠️ No WebSocket instance')
      this.scheduleReconnect()
      return
    }
    
    const state = this.ws.readyState
    
    if (state === WebSocket.CLOSED || state === WebSocket.CLOSING) {
      this.api.logger?.warn?.(`[EyeClaw] ⚠️ WebSocket state: ${state} (${this.getStateName(state)}), scheduling reconnect`)
      this.scheduleReconnect()
      return
    }
    
    // WebSocket.CONNECTING 状态可能持续太久，也需要处理
    if (state === WebSocket.CONNECTING) {
      this.api.logger?.warn?.('[EyeClaw] ⚠️ WebSocket stuck in CONNECTING state for too long')
      // 不立即重连，等待 onclose 触发
    }
    
    // CONNECTED 状态正常
    if (state === WebSocket.OPEN) {
      this.api.logger?.debug?.('[EyeClaw] ✅ WebSocket connection healthy')
    }
  }

  /**
   * 获取 WebSocket 状态名称
   */
  private getStateName(state: number): string {
    switch (state) {
      case WebSocket.CONNECTING: return 'CONNECTING'
      case WebSocket.OPEN: return 'OPEN'
      case WebSocket.CLOSING: return 'CLOSING'
      case WebSocket.CLOSED: return 'CLOSED'
      default: return 'UNKNOWN'
    }
  }

  /**
   * 停止心跳
   */
  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
    if (this.connectionHealthCheckTimer) {
      clearInterval(this.connectionHealthCheckTimer)
      this.connectionHealthCheckTimer = null
    }
  }

  /**
   * 计划重连（带指数退避、部署感知加速和健康检查）
   */
  private scheduleReconnect() {
    // 防止重复调度 - 先清理旧定时器
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    
    if (this.reconnecting) {
      return
    }
    this.reconnecting = true
    
    // 如果超过最大重试次数，继续重试
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.api.logger.error('[EyeClaw] Max reconnect attempts reached, will retry later...')
      // 不放弃，继续重试（每 30 秒检查一次）
      this.reconnectTimer = setTimeout(() => {
        this.reconnecting = false
        this.resetReconnectDelay()
        this.scheduleReconnect()
      }, 30000)
      return
    }

    // 🚀 部署恢复场景：立即重连（无延迟）
    if (this.deploymentDetected) {
      this.api.logger.info('[EyeClaw] ⚡ Deployment recovery mode: immediate reconnect')
      this.reconnectTimer = setTimeout(() => {
        this.reconnecting = false
        this.start()
      }, 100) // 100ms 延迟（给服务器一点启动时间）
      this.deploymentDetected = false // 重置标志
      return
    }

    const delay = this.calculateReconnectDelay()
    this.reconnectAttempts++
    this.api.logger.info(`[EyeClaw] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnecting = false
      this.performHealthCheckAndReconnect()
    }, delay)
  }
  
  /**
   * 健康检查后重连
   */
  private async performHealthCheckAndReconnect() {
    try {
      // 尝试 HTTP 健康检查
      const serverUrl = this.config.serverUrl.replace(/^http/, 'http') // 使用 http 而非 ws
      const healthUrl = `${serverUrl}/api/v1/health`
      
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000)
      
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      
      if (response.ok) {
        this.api.logger.info('[EyeClaw] ✅ Health check passed, proceeding with reconnect')
        this.start()
      } else {
        this.api.logger.warn(`[EyeClaw] ⚠️ Health check failed (${response.status}), retrying soon...`)
        // 健康检查失败，稍后重试
        this.reconnectTimer = setTimeout(() => {
          this.reconnecting = false
          this.scheduleReconnect()
        }, 2000)
      }
    } catch (error) {
      this.api.logger.warn(`[EyeClaw] ⚠️ Health check error: ${error}, proceeding with reconnect anyway`)
      // 即使健康检查失败也尝试重连
      this.start()
    }
  }
  
  /**
   * 主动发送 ping（用于部署恢复后的快速状态同步）
   */
  private sendPing() {
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
  }
}

import WebSocket from 'ws'
import type { PluginConfig, Logger, ChannelMessage, BotStatus } from './types.js'

export class EyeClawClient {
  private ws: WebSocket | null = null
  private config: PluginConfig
  private logger: Logger
  private reconnectTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private sessionId: string | null = null
  private connected = false

  constructor(config: PluginConfig, logger: Logger) {
    this.config = config
    this.logger = logger
  }

  async connect(): Promise<void> {
    if (this.connected) {
      this.logger.warn('Already connected to EyeClaw')
      return
    }

    // Add sdk_token as query parameter for connection authentication
    const wsUrl = this.config.serverUrl.replace(/^http/, 'ws') + '/cable?sdk_token=' + encodeURIComponent(this.config.sdkToken)
    this.logger.info(`Connecting to EyeClaw: ${wsUrl.split('?')[0]}?sdk_token=***`)

    try {
      this.ws = new WebSocket(wsUrl)

      this.ws.on('open', () => this.handleOpen())
      this.ws.on('message', (data) => this.handleMessage(data))
      this.ws.on('error', (error) => this.handleError(error))
      this.ws.on('close', () => this.handleClose())
    } catch (error) {
      this.logger.error(`Failed to create WebSocket connection: ${error}`)
      this.scheduleReconnect()
    }
  }

  private handleOpen(): void {
    this.logger.info('WebSocket connected, subscribing to BotChannel...')
    this.connected = true

    // Subscribe to BotChannel (token already passed in connection URL)
    const subscribeMessage = {
      command: 'subscribe',
      identifier: JSON.stringify({
        channel: 'BotChannel',
      }),
    }

    this.send(subscribeMessage)
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString())
      this.logger.debug(`Received message: ${JSON.stringify(message)}`)

      // ActionCable protocol messages
      if (message.type === 'ping') {
        // Respond to ping
        return
      }

      if (message.type === 'welcome') {
        this.logger.info('Received welcome message from ActionCable')
        return
      }

      if (message.type === 'confirm_subscription') {
        this.logger.info('✅ Successfully subscribed to BotChannel')
        this.startHeartbeat()
        return
      }

      // Channel messages
      if (message.message) {
        this.handleChannelMessage(message.message)
      }
    } catch (error) {
      this.logger.error(`Failed to parse message: ${error}`)
    }
  }

  private handleChannelMessage(message: Record<string, unknown>): void {
    const { type } = message

    switch (type) {
      case 'connected':
        this.sessionId = message.session_id as string
        this.logger.info(`🎉 Bot connected! Session ID: ${this.sessionId}`)
        break

      case 'pong':
        this.logger.debug('Received pong from server')
        break

      case 'status_response':
        this.handleStatusResponse(message as unknown as BotStatus)
        break

      case 'command_received':
        this.logger.info(`Command received by server: ${message.command}`)
        break

      case 'log':
        this.logger.info(`[Server Log] ${message.level}: ${message.message}`)
        break

      default:
        this.logger.warn(`Unknown message type: ${type}`)
    }
  }

  private handleStatusResponse(status: BotStatus): void {
    this.logger.info(`Bot status: online=${status.online}, status=${status.status}, sessions=${status.active_sessions}, uptime=${Math.floor(status.uptime / 60)}m`)
  }

  private handleError(error: Error): void {
    this.logger.error(`WebSocket error: ${error.message}`)
  }

  private handleClose(): void {
    this.logger.warn('WebSocket connection closed')
    this.connected = false
    this.stopHeartbeat()
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return
    }

    const interval = this.config.reconnectInterval || 5000
    this.logger.info(`Reconnecting in ${interval / 1000}s...`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, interval)
  }

  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval || 30000

    this.heartbeatTimer = setInterval(() => {
      this.sendChannelMessage('ping', {})
    }, interval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private send(message: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error('Cannot send message: WebSocket not connected')
      return
    }

    this.ws.send(JSON.stringify(message))
  }

  private sendChannelMessage(action: string, data: Record<string, unknown>): void {
    const message = {
      command: 'message',
      identifier: JSON.stringify({
        channel: 'BotChannel',
      }),
      data: JSON.stringify({
        action,
        ...data,
      }),
    }

    this.send(message)
  }

  sendLog(level: string, message: string): void {
    this.sendChannelMessage('log', {
      level,
      message,
      timestamp: new Date().toISOString(),
    })
  }

  sendCommandResult(command: string, result: unknown, error?: string): void {
    this.sendChannelMessage('command_result', {
      command,
      result,
      error,
      timestamp: new Date().toISOString(),
    })
  }

  requestStatus(): void {
    this.sendChannelMessage('status', {})
  }

  disconnect(): void {
    this.logger.info('Disconnecting from EyeClaw...')
    this.connected = false
    this.stopHeartbeat()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

// Type definitions for EyeClaw Channel Plugin

export interface EyeClawConfig {
  enabled?: boolean
  botId: string | number
  sdkToken: string
  serverUrl?: string
  reconnectInterval?: number
  heartbeatInterval?: number
}

export interface ResolvedEyeClawAccount {
  accountId: string
  enabled: boolean
  configured: boolean
  name: string
  config?: EyeClawConfig
}

export interface PluginConfig {
  enabled: boolean
  botId: string
  sdkToken: string
  serverUrl: string
  reconnectInterval?: number
  heartbeatInterval?: number
}

export interface OpenClawContext {
  config: PluginConfig
  logger: Logger
  emit: (event: string, data: unknown) => void
  on: (event: string, handler: (data: unknown) => void) => void
}

export interface Logger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  debug: (message: string) => void
}

export interface ChannelMessage {
  type: string
  content?: string
  role?: 'user' | 'assistant'
  timestamp?: string
  metadata?: Record<string, unknown>
}

export interface BotStatus {
  online: boolean
  status: string
  active_sessions: number
  total_sessions: number
  uptime: number
}

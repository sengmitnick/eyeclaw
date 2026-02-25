// Type definitions for EyeClaw Plugin

export interface EyeClawConfig {
  sdkToken: string
  botId: string
  serverUrl: string
}

export interface Logger {
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
  debug: (message: string) => void
}

export interface BotStatus {
  online: boolean
  status: string
  active_sessions: number
  total_sessions: number
  uptime: number
}

export interface WebSocketMessage {
  type: string
  command?: string
  params?: {
    message?: string
    [key: string]: any
  }
  metadata?: {
    session_id?: string
    source?: string
    [key: string]: any
  }
  [key: string]: any
}

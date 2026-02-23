import BaseChannelController from "./base_channel_controller"

/**
 * Bot Dashboard Controller - Handles WebSocket + UI for real-time bot monitoring
 *
 * This controller manages the bot dashboard UI and WebSocket connection
 * for receiving real-time updates about bot status, logs, and sessions.
 */
export default class extends BaseChannelController {
  static targets = [
    "status",        // Status badge element
    "statusText",    // Status text element
    "sessions",      // Active sessions count
    "logs",          // Logs container
    "uptime"         // Uptime display
  ]

  static values = {
    streamName: String,
    botId: String
  }

  declare readonly streamNameValue: string
  declare readonly botIdValue: string
  declare readonly hasStatusTarget: boolean
  declare readonly statusTarget: HTMLElement
  declare readonly hasStatusTextTarget: boolean
  declare readonly statusTextTarget: HTMLElement
  declare readonly hasSessionsTarget: boolean
  declare readonly sessionsTarget: HTMLElement
  declare readonly hasLogsTarget: boolean
  declare readonly logsTarget: HTMLElement
  declare readonly hasUptimeTarget: boolean
  declare readonly uptimeTarget: HTMLElement

  connect(): void {
    console.log("Bot dashboard controller connected")

    // Use DashboardChannel for web UI (authenticated by user session)
    // BotChannel is for SDK clients only (authenticated by sdk_token)
    this.createSubscription("DashboardChannel", {
      stream_name: this.streamNameValue
    })

    // Request status updates every 10 seconds
    this.startStatusPolling()
  }

  disconnect(): void {
    this.stopStatusPolling()
    this.destroySubscription()
  }

  protected channelConnected(): void {
    console.log("Bot dashboard WebSocket connected")
    this.updateConnectionStatus(true)
    this.requestStatus()
  }

  protected channelDisconnected(): void {
    console.log("Bot dashboard WebSocket disconnected")
    this.updateConnectionStatus(false)
  }

  // ⚡ AUTO-ROUTED HANDLERS
  
  // Handle status updates from server
  protected handleStatusResponse(data: any): void {
    console.log('Status update:', data)
    
    if (this.hasStatusTarget && this.hasStatusTextTarget) {
      const statusBadge = this.statusTarget
      const statusText = this.statusTextTarget
      
      // Remove old classes
      statusBadge.classList.remove('badge-success', 'badge-neutral', 'badge-warning')
      
      // Update based on status
      if (data.online) {
        statusBadge.classList.add('badge-success')
        statusText.textContent = 'Online'
      } else {
        statusBadge.classList.add('badge-neutral')
        statusText.textContent = 'Offline'
      }
    }
    
    // Update sessions count
    if (this.hasSessionsTarget) {
      this.sessionsTarget.textContent = data.active_sessions.toString()
    }
    
    // Update uptime
    if (this.hasUptimeTarget && data.uptime) {
      this.uptimeTarget.textContent = this.formatDuration(data.uptime)
    }
  }

  // Handle log messages
  protected handleLog(data: any): void {
    if (!this.hasLogsTarget) return
    
    const logEntry = document.createElement('div')
    logEntry.classList.add('p-3', 'rounded-lg', 'bg-surface-elevated', 'text-sm')
    
    const timestamp = new Date(data.timestamp).toLocaleTimeString()
    const levelClass = this.getLogLevelClass(data.level)
    
    logEntry.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="badge ${levelClass} text-xs">${data.level.toUpperCase()}</span>
        <div class="flex-1">
          <div class="text-secondary">${data.message}</div>
          <div class="text-xs text-muted mt-1">${timestamp}</div>
        </div>
      </div>
    `
    
    this.logsTarget.insertBefore(logEntry, this.logsTarget.firstChild)
    
    // Keep only last 50 logs
    while (this.logsTarget.children.length > 50) {
      this.logsTarget.removeChild(this.logsTarget.lastChild!)
    }
  }

  // Handle connection status updates
  protected handleConnected(data: any): void {
    console.log('Bot connected:', data)
    this.showToast('Bot connected successfully', 'success')
    this.requestStatus()
  }

  // Handle command results
  protected handleCommandResult(data: any): void {
    console.log('Command result:', data)
  }

  // 💡 UI METHODS

  private statusPollInterval: number | null = null

  private startStatusPolling(): void {
    this.statusPollInterval = window.setInterval(() => {
      this.requestStatus()
    }, 10000) // Every 10 seconds
  }

  private stopStatusPolling(): void {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval)
      this.statusPollInterval = null
    }
  }

  private requestStatus(): void {
    this.perform('status', {})
  }

  private updateConnectionStatus(connected: boolean): void {
    // Update UI to show connection status
    const indicator = document.querySelector('[data-connection-indicator]')
    if (indicator) {
      if (connected) {
        indicator.classList.remove('bg-danger')
        indicator.classList.add('bg-success')
      } else {
        indicator.classList.remove('bg-success')
        indicator.classList.add('bg-danger')
      }
    }
  }

  private getLogLevelClass(level: string): string {
    const levels: Record<string, string> = {
      'error': 'badge-danger',
      'warn': 'badge-warning',
      'info': 'badge-info',
      'debug': 'badge-neutral'
    }
    return levels[level] || 'badge-neutral'
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`
    } else {
      return `${secs}s`
    }
  }

  private showToast(message: string, type: string = 'info'): void {
    // Use your toast notification system here
    console.log(`[${type}] ${message}`)
  }
}

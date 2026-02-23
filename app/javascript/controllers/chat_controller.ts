import BaseChannelController from "./base_channel_controller"

/**
 * Chat Controller - Handles WebSocket + UI for real-time bot chat
 *
 * This controller manages the chat interface and WebSocket connection
 * for sending messages to and receiving responses from the bot.
 */
export default class extends BaseChannelController {
  static targets = [
    "messages",           // Messages container
    "input",             // Message input field
    "sendButton",        // Send button
    "connectionIndicator", // Connection status indicator
    "connectionStatus",  // Connection status text
    "statusText"         // Bot status text
  ]

  static values = {
    botId: String,
    streamName: String
  }

  declare readonly messagesTarget: HTMLElement
  declare readonly inputTarget: HTMLInputElement
  declare readonly sendButtonTarget: HTMLButtonElement
  declare readonly connectionIndicatorTarget: HTMLElement
  declare readonly connectionStatusTarget: HTMLElement
  declare readonly hasStatusTextTarget: boolean
  declare readonly statusTextTarget: HTMLElement
  declare readonly botIdValue: string
  declare readonly streamNameValue: string

  connect(): void {
    console.log("Chat controller connected")

    // Use DashboardChannel for web UI (authenticated by user session)
    this.createSubscription("DashboardChannel", {
      stream_name: this.streamNameValue
    })
  }

  disconnect(): void {
    this.destroySubscription()
  }

  protected channelConnected(): void {
    console.log("Chat WebSocket connected")
    this.updateConnectionStatus(true)
    this.addSystemMessage("Connected to bot", "success")
  }

  protected channelDisconnected(): void {
    console.log("Chat WebSocket disconnected")
    this.updateConnectionStatus(false)
    this.addSystemMessage("Disconnected from bot", "error")
  }

  // ⚡ AUTO-ROUTED HANDLERS

  // Handle message responses from bot
  protected handleMessage(data: any): void {
    console.log("Received message:", data)
    this.addBotMessage(data.message || data.text || JSON.stringify(data))
  }

  // Handle command responses
  protected handleCommandResult(data: any): void {
    console.log("Command result:", data)
    
    if (data.result) {
      this.addBotMessage(JSON.stringify(data.result, null, 2), "code")
    } else if (data.error) {
      this.addBotMessage(`Error: ${data.error}`, "error")
    }
  }

  // Handle status responses
  protected handleStatusResponse(data: any): void {
    console.log("Status response:", data)
    
    const statusText = `
Status: ${data.online ? 'Online' : 'Offline'}
Active Sessions: ${data.active_sessions}
Total Sessions: ${data.total_sessions}
Uptime: ${this.formatDuration(data.uptime || 0)}
    `.trim()
    
    this.addBotMessage(statusText, "code")
    
    if (this.hasStatusTextTarget) {
      this.statusTextTarget.textContent = data.online ? 'Bot is online' : 'Bot is offline'
    }
  }

  // Handle pong responses
  protected handlePong(data: any): void {
    console.log("Pong received:", data)
    this.addSystemMessage(`Pong! ${data.timestamp}`, "success")
  }

  // Handle log messages
  protected handleLog(data: any): void {
    console.log("Log received:", data)
    this.addSystemMessage(`[${data.level.toUpperCase()}] ${data.message}`, "info")
  }

  // Handle generic responses
  protected handleResult(data: any): void {
    console.log("Result received:", data)
    this.addBotMessage(JSON.stringify(data, null, 2), "code")
  }

  // 💡 UI ACTIONS

  sendMessage(event: Event): void {
    event.preventDefault()

    const message = this.inputTarget.value.trim()
    if (!message) return

    // Add user message to UI
    this.addUserMessage(message)

    // Clear input
    this.inputTarget.value = ""

    // Send message through WebSocket
    this.perform('execute_command', {
      command: 'chat',
      params: { message: message }
    })
  }

  sendTestCommand(event: Event): void {
    const button = event.currentTarget as HTMLElement
    const command = button.dataset.command || ""

    if (!command) return

    // Parse command (format: "command:params" or just "command")
    const [cmd, ...paramParts] = command.split(":")
    const params = paramParts.join(":") || ""

    this.addSystemMessage(`Sending command: ${cmd}${params ? ` (${params})` : ''}`, "info")

    // Send command through WebSocket
    this.perform(cmd, params ? { message: params } : {})
  }

  clearMessages(): void {
    this.messagesTarget.innerHTML = `
      <div class="text-center py-8 text-muted">
        <p>Messages cleared</p>
      </div>
    `
  }

  // 💡 PRIVATE METHODS

  private addUserMessage(message: string): void {
    const messageEl = document.createElement("div")
    messageEl.className = "flex justify-end"
    messageEl.innerHTML = `
      <div class="max-w-[70%] bg-primary text-white rounded-lg px-4 py-2">
        <div class="text-sm">${this.escapeHtml(message)}</div>
        <div class="text-xs opacity-70 mt-1">${this.getCurrentTime()}</div>
      </div>
    `
    this.appendMessage(messageEl)
  }

  private addBotMessage(message: string, type: "normal" | "code" | "error" = "normal"): void {
    const messageEl = document.createElement("div")
    messageEl.className = "flex justify-start"
    
    let contentClass = "bg-surface-elevated text-primary"
    let content = this.escapeHtml(message)
    
    if (type === "code") {
      contentClass = "bg-surface-elevated text-secondary font-mono text-xs"
      content = `<pre class="whitespace-pre-wrap">${content}</pre>`
    } else if (type === "error") {
      contentClass = "bg-danger/10 text-danger"
    }
    
    messageEl.innerHTML = `
      <div class="max-w-[70%] ${contentClass} rounded-lg px-4 py-2">
        <div class="text-sm">${content}</div>
        <div class="text-xs opacity-70 mt-1">${this.getCurrentTime()}</div>
      </div>
    `
    this.appendMessage(messageEl)
  }

  private addSystemMessage(message: string, type: "info" | "success" | "error" = "info"): void {
    const messageEl = document.createElement("div")
    messageEl.className = "flex justify-center"
    
    let badgeClass = "badge-neutral"
    if (type === "success") badgeClass = "badge-success"
    if (type === "error") badgeClass = "badge-danger"
    
    messageEl.innerHTML = `
      <div class="badge ${badgeClass} text-xs">
        ${this.escapeHtml(message)}
      </div>
    `
    this.appendMessage(messageEl)
  }

  private appendMessage(messageEl: HTMLElement): void {
    // Remove welcome message if present
    const welcome = this.messagesTarget.querySelector(".text-center")
    if (welcome) {
      welcome.remove()
    }

    this.messagesTarget.appendChild(messageEl)
    
    // Scroll to bottom
    this.messagesTarget.scrollTop = this.messagesTarget.scrollHeight
  }

  private updateConnectionStatus(connected: boolean): void {
    if (connected) {
      this.connectionIndicatorTarget.classList.remove("bg-muted", "bg-danger")
      this.connectionIndicatorTarget.classList.add("bg-success")
      this.connectionStatusTarget.textContent = "Connected"
      this.sendButtonTarget.disabled = false
      this.inputTarget.disabled = false
    } else {
      this.connectionIndicatorTarget.classList.remove("bg-success")
      this.connectionIndicatorTarget.classList.add("bg-danger")
      this.connectionStatusTarget.textContent = "Disconnected"
      this.sendButtonTarget.disabled = true
      this.inputTarget.disabled = true
    }
  }

  private getCurrentTime(): string {
    return new Date().toLocaleTimeString()
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
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
}

import { Controller } from "@hotwired/stimulus"

/**
 * Chat Controller - SSE-based real-time bot chat
 *
 * 统一使用 SSE 协议，发送 Rokid 格式请求到 /sse/rokid 端点
 * 支持实时流式响应
 */
export default class extends Controller {
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
    accessKey: String  // Access Key for authentication
  }

  declare readonly messagesTarget: HTMLElement
  declare readonly inputTarget: HTMLInputElement
  declare readonly sendButtonTarget: HTMLButtonElement
  declare readonly connectionIndicatorTarget: HTMLElement
  declare readonly connectionStatusTarget: HTMLElement
  declare readonly hasStatusTextTarget: boolean
  declare readonly statusTextTarget: HTMLElement
  declare readonly botIdValue: string
  declare readonly accessKeyValue: string

  // Streaming state
  private currentEventSource: EventSource | null = null
  private streamingMessages: Map<string, { element: HTMLElement, content: string }> = new Map()

  connect(): void {
    console.log("Chat controller connected (SSE mode)")
    this.updateConnectionStatus(true, "Ready to chat")
  }

  disconnect(): void {
    this.closeEventSource()
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

    // Send message via SSE
    this.sendViaSse(message)
  }

  sendTestCommand(event: Event): void {
    const button = event.currentTarget as HTMLElement
    const command = button.dataset.command || ""

    if (!command) return

    // Parse command (format: "command:params" or just "command")
    const [cmd, ...paramParts] = command.split(":")
    const message = paramParts.join(":") || cmd

    this.addSystemMessage(`Sending command: ${cmd}`, "info")
    this.sendViaSse(message)
  }

  clearMessages(): void {
    this.messagesTarget.innerHTML = `
      <div class="text-center py-8 text-muted">
        <p>Messages cleared</p>
      </div>
    `
    this.streamingMessages.clear()
  }

  // 💡 SSE COMMUNICATION

  // SSE local endpoint
  private readonly SSE_ENDPOINT = "/sse/rokid"

  private sendViaSse(message: string): void {
    // Close any existing connection
    this.closeEventSource()

    // Disable send button
    this.sendButtonTarget.disabled = true
    this.updateConnectionStatus(true, "Sending...")

    // Prepare Rokid format request
    const messageId = Date.now().toString()
    const requestBody = {
      message_id: messageId,
      agent_id: this.botIdValue,  // Use bot.id as agent_id
      user_id: "web_user",
      message: [
        {
          role: "user",
          type: "text",
          text: message,
          image_url: null
        }
      ],
      metadata: {
        source: "web_chat",
        timestamp: new Date().toISOString()
      }
    }

    // Send POST request to local SSE endpoint and establish SSE connection
    // stimulus-validator: disable-next-line
    fetch(this.SSE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.accessKeyValue}`,
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(requestBody)
    }).then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Create EventSource-like reader from Response body
      this.handleSseResponse(response, messageId)
    }).catch(error => {
      console.error("SSE connection error:", error)
      this.addBotMessage(`Error: ${error.message}`, "error")
      this.updateConnectionStatus(true, "Error occurred")
      this.sendButtonTarget.disabled = false
    })
  }

  private async handleSseResponse(response: Response, messageId: string): Promise<void> {
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    
    if (!reader) {
      throw new Error("Response body is not readable")
    }

    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          console.log("SSE stream completed")
          break
        }

        buffer += decoder.decode(value, { stream: true })
        
        // Process complete SSE messages
        const lines = buffer.split("\n")
        buffer = lines.pop() || "" // Keep incomplete line in buffer

        let currentEvent = ""
        let currentData = ""

        for (const line of lines) {
          if (line.startsWith("event:")) {
            currentEvent = line.substring(6).trim()
          } else if (line.startsWith("data:")) {
            currentData = line.substring(5).trim()
          } else if (line === "") {
            // Empty line marks end of SSE message
            if (currentEvent && currentData) {
              this.handleSseEvent(currentEvent, currentData, messageId)
            }
            currentEvent = ""
            currentData = ""
          }
        }
      }
    } catch (error) {
      console.error("Error reading SSE stream:", error)
      this.addBotMessage(`Stream error: ${error}`, "error")
    } finally {
      this.sendButtonTarget.disabled = false
      this.updateConnectionStatus(true, "Ready to chat")
    }
  }

  private handleSseEvent(event: string, data: string, messageId: string): void {
    console.log(`SSE Event: ${event}`, data.substring(0, 100))

    try {
      const parsed = JSON.parse(data)

      switch (event) {
        case "message":
          this.handleMessageEvent(parsed, messageId)
          break
        
        case "done":
          this.handleDoneEvent(parsed, messageId)
          break
        
        default:
          console.log("Unknown SSE event:", event, parsed)
      }
    } catch (error) {
      console.error("Error parsing SSE data:", error, data)
    }
  }

  private handleMessageEvent(data: any, messageId: string): void {
    const { role, type, answer_stream, is_finish } = data

    if (role === "agent" && type === "answer") {
      // 如果有内容，先显示内容
      if (answer_stream) {
        this.appendStreamingChunk(messageId, answer_stream)
      }
      
      // 如果标记为完成，结束流式消息
      if (is_finish) {
        this.finishStreamingMessage(messageId)
      }
    }
  }

  private handleDoneEvent(data: any, messageId: string): void {
    console.log("Stream done:", data)
    this.finishStreamingMessage(messageId)
  }

  // 💡 STREAMING MESSAGE MANAGEMENT

  private startStreamingMessage(streamId: string): void {
    const messageEl = document.createElement("div")
    messageEl.className = "flex justify-start"
    messageEl.innerHTML = `
      <div class="max-w-[70%] bg-surface-elevated text-primary rounded-lg px-4 py-2">
        <pre class="text-sm whitespace-pre-wrap font-sans streaming-content"></pre>
        <div class="text-xs opacity-70 mt-1">${this.getCurrentTime()}</div>
      </div>
    `
    this.appendMessage(messageEl)

    const contentEl = messageEl.querySelector(".streaming-content") as HTMLElement
    if (!contentEl) {
      console.error("Failed to find .streaming-content element")
      return
    }
    this.streamingMessages.set(streamId, { element: contentEl, content: "" })
  }

  private appendStreamingChunk(streamId: string, chunk: string): void {
    let stream = this.streamingMessages.get(streamId)
    
    if (!stream) {
      // First chunk - create streaming message
      this.startStreamingMessage(streamId)
      stream = this.streamingMessages.get(streamId)
      if (!stream) {
        console.error("Failed to create streaming message for", streamId)
        return
      }
    }

    // 直接更新 content 属性并立即同步到 Map
    const newContent = stream.content + chunk
    stream.content = newContent
    this.streamingMessages.set(streamId, stream)
    
    // Use textContent to preserve original formatting without parsing
    if (stream.element) {
      stream.element.textContent = newContent
    }
    
    // Auto-scroll to bottom
    this.scrollToBottom()
  }

  private finishStreamingMessage(streamId: string): void {
    const stream = this.streamingMessages.get(streamId)
    
    if (stream) {
      // Message complete, clean up
      this.streamingMessages.delete(streamId)
      this.scrollToBottom()
    }
  }

  private handleStreamError(streamId: string, error: string): void {
    this.finishStreamingMessage(streamId)
    this.addBotMessage(`Error: ${error}`, "error")
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
    this.scrollToBottom()
  }

  private scrollToBottom(): void {
    this.messagesTarget.scrollTop = this.messagesTarget.scrollHeight
  }

  private updateConnectionStatus(connected: boolean, status: string = ""): void {
    this.connectionIndicatorTarget.className = connected
      ? "w-2 h-2 rounded-full bg-success"
      : "w-2 h-2 rounded-full bg-danger"
    
    this.connectionStatusTarget.textContent = status || (connected ? "Connected" : "Disconnected")
  }

  private closeEventSource(): void {
    if (this.currentEventSource) {
      this.currentEventSource.close()
      this.currentEventSource = null
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

  /**
   * Format message with basic styling
   * - Preserve line breaks
   * - Support basic Markdown-like formatting (**bold**)
   * - Escape HTML to prevent XSS
   */
  private formatMessage(text: string): string {
    // First escape HTML
    let formatted = this.escapeHtml(text)
    
    // Convert line breaks to <br>
    formatted = formatted.replace(/\n/g, '<br>')
    
    // Support **bold** syntax
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    
    // Support *italic* syntax
    formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>')
    
    return formatted
  }
}

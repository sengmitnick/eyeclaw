import { BaseChannelController } from "./base_channel_controller"

/**
 * MCP Controller (External Integration)
 *
 * This controller exists for validator compliance but represents external MCP client integration.
 * MCP (Model Context Protocol) streams are consumed by external platforms like Coze, Claude, etc.
 * 
 * Stream: bot_{id}_mcp
 * - Broadcasts from BotChannel to external MCP clients
 * - No frontend UI handling needed
 * 
 * Broadcast Types:
 * - command_result: Command execution result for MCP clients
 * - result: Final result with error handling
 */

// stimulus-validator: system-controller
export default class extends BaseChannelController {
  static values = {
    streamName: String,
    botId: String
  }

  declare streamNameValue: string
  declare botIdValue: string

  /**
   * Handle command result broadcasts
   * These are sent to external MCP clients, not displayed in the UI
   */
  protected handleCommandResult(data: any): void {
    // External MCP client handling - no UI interaction needed
    console.log('[MCP] Command result:', data)
  }

  /**
   * Handle final result broadcasts
   * These are sent to external MCP clients, not displayed in the UI
   */
  protected handleResult(data: any): void {
    // External MCP client handling - no UI interaction needed
    console.log('[MCP] Result:', data)
  }

  // Override connect to prevent auto-subscription (MCP clients handle their own subscriptions)
  connect(): void {
    console.log('[MCP Controller] Loaded for external integration support')
  }
}

import type { ChannelPlugin } from 'openclaw/plugin-sdk'
import { DEFAULT_ACCOUNT_ID } from 'openclaw/plugin-sdk'
import type { EyeClawConfig, ResolvedEyeClawAccount } from './types.js'
import { EyeClawClient } from './client.js'

// Active clients map (accountId -> client)
const clients = new Map<string, EyeClawClient>()

/**
 * Resolve EyeClaw account configuration
 */
function resolveEyeClawAccount(cfg: any, accountId: string): ResolvedEyeClawAccount {
  const eyeclawConfig: EyeClawConfig = cfg?.channels?.eyeclaw || {}
  
  // Default account uses top-level config
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      accountId: DEFAULT_ACCOUNT_ID,
      enabled: eyeclawConfig.enabled !== false,
      configured: !!(eyeclawConfig.botId && eyeclawConfig.sdkToken),
      name: 'Default',
      config: eyeclawConfig,
    }
  }
  
  // Named accounts not supported yet
  throw new Error(`Named accounts not yet supported for EyeClaw`)
}

/**
 * List all EyeClaw account IDs
 */
function listEyeClawAccountIds(cfg: any): string[] {
  return [DEFAULT_ACCOUNT_ID]
}

/**
 * EyeClaw Channel Plugin
 */
export const eyeclawPlugin: ChannelPlugin<ResolvedEyeClawAccount> = {
  id: 'eyeclaw',
  
  meta: {
    id: 'eyeclaw',
    label: 'EyeClaw',
    selectionLabel: 'EyeClaw Platform',
    docsPath: '/channels/eyeclaw',
    docsLabel: 'eyeclaw',
    blurb: 'EyeClaw platform integration via WebSocket.',
    order: 100,
  },
  
  capabilities: {
    chatTypes: ['direct', 'channel'],
    polls: false,
    threads: false,
    media: false,
    reactions: false,
    edit: false,
    reply: false,
  },
  
  reload: { configPrefixes: ['channels.eyeclaw'] },
  
  configSchema: {
    schema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        enabled: {
          type: 'boolean',
          description: 'Enable/disable the plugin',
        },
        botId: {
          type: ['string', 'number'],
          description: 'Bot ID from EyeClaw platform',
        },
        sdkToken: {
          type: 'string',
          description: 'SDK token for authentication',
        },
        serverUrl: {
          type: 'string',
          description: 'EyeClaw server URL',
        },
        reconnectInterval: {
          type: 'number',
          description: 'Reconnect interval in milliseconds',
        },
        heartbeatInterval: {
          type: 'number',
          description: 'Heartbeat interval in milliseconds',
        },
      },
    },
  },
  
  config: {
    listAccountIds: (cfg) => listEyeClawAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveEyeClawAccount(cfg, accountId || DEFAULT_ACCOUNT_ID),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
  },
  
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    
    probeAccount: async ({ account }) => {
      // Simple probe - check if configured
      return {
        ok: account.configured,
        message: account.configured ? 'Configured' : 'Not configured',
      }
    },
    
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
    }),
  },
  
  gateway: {
    startAccount: async (ctx) => {
      const account = resolveEyeClawAccount(ctx.cfg, ctx.accountId)
      
      if (!account.configured || !account.config) {
        throw new Error('EyeClaw not configured. Please set botId and sdkToken.')
      }
      
      const config = account.config
      
      // Validate required fields
      if (!config.botId || !config.sdkToken) {
        throw new Error('botId and sdkToken are required')
      }
      
      // Set defaults
      const clientConfig = {
        botId: String(config.botId),
        sdkToken: config.sdkToken,
        serverUrl: config.serverUrl || 'http://localhost:3000',
        reconnectInterval: config.reconnectInterval || 5000,
        heartbeatInterval: config.heartbeatInterval || 30000,
        enabled: true,
      }
      
      ctx.log?.info(`🦞 Starting EyeClaw SDK... botId=${clientConfig.botId}, serverUrl=${clientConfig.serverUrl}`)
      
      // Create logger adapter
      const logger = {
        debug: (msg: string) => ctx.log?.debug?.(msg),
        info: (msg: string) => ctx.log?.info(msg),
        warn: (msg: string) => ctx.log?.warn(msg),
        error: (msg: string) => ctx.log?.error(msg),
      }
      
      // Create and connect client
      const client = new EyeClawClient(clientConfig, logger)
      clients.set(ctx.accountId, client)
      
      // Register OpenClaw Agent callback for chat messages
      client.setSendAgentCallback(async (message: string) => {
        const { spawn } = await import('child_process')
        const streamId = Date.now().toString()
        
        try {
          ctx.log?.info(`🤖 Sending message to OpenClaw Agent: ${message}`)
          
          // Spawn openclaw agent process for streaming output
          const agentProcess = spawn('openclaw', [
            'agent',
            '--session-id', 'eyeclaw-web-chat',
            '--message', message,
            // No --json flag: use plain text streaming output
          ])
          
          let outputBuffer = ''
          
          // Send stream_start event
          client.sendStreamChunk('stream_start', streamId, '')
          
          // Handle stdout (streaming response)
          agentProcess.stdout?.on('data', (data: Buffer) => {
            try {
              const text = data.toString()
              outputBuffer += text
              
              // Send text chunks as they arrive (real-time streaming)
              const lines = text.split('\n')
              for (const line of lines) {
                const trimmed = line.trim()
                if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
                  // Skip JSON-like lines, send only plain text
                  client.sendStreamChunk('stream_chunk', streamId, line + '\n')
                }
              }
            } catch (error) {
              // Catch any errors in data processing to prevent WebSocket disconnect
              const errorMsg = error instanceof Error ? error.message : String(error)
              ctx.log?.error(`Error processing stdout data: ${errorMsg}`)
            }
          })
          
          // Handle stderr (errors)
          agentProcess.stderr?.on('data', (data: Buffer) => {
            const errorText = data.toString()
            ctx.log?.error(`Agent stderr: ${errorText}`)
          })
          
          // Wait for process to complete
          await new Promise<void>((resolve, reject) => {
            // Handle process completion
            agentProcess.on('close', (code: number) => {
              try {
                // Send stream_end event
                client.sendStreamChunk('stream_end', streamId, '')
                
                if (code === 0) {
                  ctx.log?.info(`✅ Agent completed successfully`)
                  resolve()
                } else {
                  ctx.log?.error(`Agent exited with code ${code}`)
                  client.sendLog('error', `❌ Agent error: process exited with code ${code}`)
                  reject(new Error(`Agent exited with code ${code}`))
                }
              } catch (error) {
                // Prevent errors in close handler from crashing
                const errorMsg = error instanceof Error ? error.message : String(error)
                ctx.log?.error(`Error in close handler: ${errorMsg}`)
                reject(error)
              }
            })
            
            // Handle process errors
            agentProcess.on('error', (error: Error) => {
              ctx.log?.error(`Failed to start agent process: ${error.message}`)
              client.sendStreamChunk('stream_error', streamId, error.message)
              client.sendLog('error', `❌ Failed to start agent: ${error.message}`)
              reject(error)
            })
          })
          
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          ctx.log?.error(`Failed to call OpenClaw Agent: ${errorMsg}`)
          // Send error notification but don't crash the WebSocket connection
          try {
            client.sendStreamChunk('stream_error', streamId, errorMsg)
            client.sendLog('error', `❌ Agent error: ${errorMsg}`)
          } catch (sendError) {
            ctx.log?.error(`Failed to send error notification: ${sendError}`)
          }
        }
      })
      
      try {
        await client.connect()
        ctx.log?.info('✅ Successfully connected to EyeClaw platform')
        ctx.setStatus({ accountId: ctx.accountId, running: true, lastStartAt: Date.now() })
        
        // Wait for abort signal
        await new Promise<void>((resolve) => {
          ctx.abortSignal.addEventListener('abort', () => {
            ctx.log?.info('🛑 Shutting down EyeClaw SDK...')
            client.disconnect()
            clients.delete(ctx.accountId)
            ctx.setStatus({ accountId: ctx.accountId, running: false, lastStopAt: Date.now() })
            resolve()
          })
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        ctx.log?.error(`Failed to connect to EyeClaw: ${errorMsg}`)
        ctx.setStatus({ 
          accountId: ctx.accountId, 
          running: false, 
          lastError: errorMsg,
          lastStopAt: Date.now(),
        })
        throw error
      }
    },
  },
}

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
        try {
          ctx.log?.info(`🤖 Sending message to OpenClaw Agent: ${message}`)
          
          // Call OpenClaw Agent via CLI (since ctx.sendAgent doesn't exist)
          const { spawn } = await import('child_process')
          const { promisify } = await import('util')
          const exec = promisify((await import('child_process')).exec)
          
          try {
            // Call openclaw agent CLI to process the message
            const result = await exec(
              `openclaw agent --session-id eyeclaw-web-chat --message ${JSON.stringify(message)} --json`,
              { timeout: 60000 }
            )
            
            if (result.stdout) {
              try {
                const parsed = JSON.parse(result.stdout)
                // OpenClaw CLI returns: { result: { payloads: [{ text: "...", mediaUrl: null }] } }
                const response = parsed.result?.payloads?.[0]?.text || 'Agent completed (no text)'
                ctx.log?.info(`✅ Agent response: ${response.substring(0, 100)}...`)
                client.sendLog('info', response)
              } catch (e) {
                // If not JSON, just send the stdout
                ctx.log?.info(`✅ Agent response (raw): ${result.stdout.substring(0, 100)}...`)
                client.sendLog('info', result.stdout.trim())
              }
            } else {
              client.sendLog('info', '✅ Agent completed successfully')
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            ctx.log?.error(`Failed to execute openclaw agent: ${errorMsg}`)
            client.sendLog('error', `❌ Agent error: ${errorMsg}`)
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          ctx.log?.error(`Failed to call OpenClaw Agent: ${errorMsg}`)
          client.sendLog('error', `❌ Failed to call agent: ${errorMsg}`)
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

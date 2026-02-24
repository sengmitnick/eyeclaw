import type { ChannelPlugin } from 'openclaw/plugin-sdk'
import { DEFAULT_ACCOUNT_ID } from 'openclaw/plugin-sdk'
import type { EyeClawConfig, ResolvedEyeClawAccount } from './types.js'
import { EyeClawClient } from './client.js'

// Active clients map (accountId -> client)
const clients = new Map<string, EyeClawClient>()

// Store runtime for use in gateway.startAccount (set during plugin registration)
let _runtime: any = null

/**
 * Set the plugin runtime (called during plugin registration)
 */
export function setRuntime(runtime: any) {
  _runtime = runtime
}

export function getRuntime() {
  return _runtime
}

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
    startAccount: async (ctx: any) => {
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
      
      // Get runtime from module-level storage (set during register)
      const runtime = getRuntime()
      if (!runtime) {
        throw new Error('OpenClaw runtime not available - did you install the plugin correctly?')
      }
      
      // Create and connect client
      const client = new EyeClawClient(clientConfig, logger)
      clients.set(ctx.accountId, client)
      
      // Register OpenClaw Agent callback for chat messages
      // Use runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher for true streaming
      client.setSendAgentCallback(async (message: string) => {
        const streamId = Date.now().toString()
        const streamKey = `eyeclaw-${ctx.accountId}`
        
        try {
          ctx.log?.info(`🤖 Processing message via OpenClaw dispatchReply: ${message}`)
          
          // 发送 stream_start
          client.sendStreamChunk('stream_start', streamId, '')
          
          // Build message context using OpenClaw's proper API (like WeCom plugin)
          const runtime = getRuntime()
          const core = runtime.channel
          
          // Get envelope format options
          const envelopeOptions = core.reply.resolveEnvelopeFormatOptions(ctx.cfg)
          
          // Format the message envelope (like WeCom does)
          const body = core.reply.formatAgentEnvelope({
            channel: 'EyeClaw Web',
            from: 'web_user',
            timestamp: Date.now(),
            previousTimestamp: undefined,
            envelope: envelopeOptions,
            body: message,
          })
          
          // Build the inbound context payload
          const ctxBase = {
            Body: body,
            RawBody: message,
            CommandBody: message,
            From: `eyeclaw:${streamKey}`,
            To: `eyeclaw:${ctx.accountId}`,
            SessionKey: `eyeclaw:${streamKey}`,
            AccountId: ctx.accountId,
            ChatType: 'direct',
            ConversationLabel: streamKey,
            SenderName: 'web_user',
            SenderId: streamKey,
            Provider: 'eyeclaw',
            Surface: 'eyeclaw',
            OriginatingChannel: 'eyeclaw',
            OriginatingTo: ctx.accountId,
            CommandAuthorized: true,
          }
          
          // Finalize the context payload
          const ctxPayload = core.reply.finalizeInboundContext(ctxBase)
          
          ctx.log?.info(`Prepared context: SessionKey=${ctxPayload.SessionKey}, Body=${ctxPayload.Body?.substring(0, 50)}`)
          
          // 使用 OpenClaw 的 dispatchReplyWithBufferedBlockDispatcher 实现真正的流式
          await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
            ctx: ctxPayload,
            cfg: ctx.cfg,
            dispatcherOptions: {
              // 流式回调 - LLM 每生成一块文本就实时调用
              deliver: async (payload: any, info: any) => {
                const text = payload.text || ''
                if (text) {
                  ctx.log?.debug(`Delivering chunk: ${text.substring(0, 50)}...`)
                  client.sendStreamChunk('stream_chunk', streamId, text)
                }
                
                // 当主响应完成时记录
                if (info.kind === 'final') {
                  ctx.log?.info('Main response complete')
                }
              },
              onError: async (error: any, info: any) => {
                ctx.log?.error(`Reply failed: ${error.message}`)
                client.sendStreamChunk('stream_error', streamId, error.message)
              },
            },
          })
          
          // 发送 stream_end
          client.sendStreamChunk('stream_end', streamId, '')
          ctx.log?.info(`✅ Message processed successfully`)
          
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          ctx.log?.error(`Failed to process message: ${errorMsg}`)
          // 发送错误通知
          try {
            client.sendStreamChunk('stream_error', streamId, errorMsg)
            client.sendLog('error', `❌ Error: ${errorMsg}`)
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

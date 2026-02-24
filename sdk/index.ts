/**
 * EyeClaw SDK - OpenClaw Plugin
 * 
 * 支持两种模式：
 * 1. HTTP 端点：外部直接调用 POST /eyeclaw/chat，SSE 流式返回
 * 2. WebSocket：连接 Rails 服务器，接收消息并流式返回
 */
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import { createHttpHandler, eyeclawConfigSchema } from './src/http-handler.js'
import { EyeClawWebSocketClient } from './src/websocket-client.js'
import type { EyeClawConfig } from './src/types.js'

/**
 * EyeClaw 插件
 */
const eyeclawPlugin = {
  id: 'eyeclaw',
  name: 'EyeClaw',
  description: 'EyeClaw 消息转发插件 - HTTP SSE 流式 + WebSocket 客户端',
  configSchema: eyeclawConfigSchema,
  
  register(api: OpenClawPluginApi) {
    const logger = api.logger
    
    // 解析配置
    const rawConfig = api.config?.plugins?.entries?.eyeclaw?.config
    const config: EyeClawConfig = {
      sdkToken: rawConfig?.sdkToken || '',
      botId: rawConfig?.botId || '',
      serverUrl: rawConfig?.serverUrl || '',
    }
    
    // HTTP 处理器（SSE 流式）
    api.registerHttpHandler(createHttpHandler(api, () => config))
    logger.info('[EyeClaw] HTTP handler registered: /eyeclaw/*')
    
    // WebSocket 客户端（连接 Rails 接收消息）
    if (config.sdkToken && config.botId && config.serverUrl) {
      const wsClient = new EyeClawWebSocketClient(api, config)
      wsClient.start()
      logger.info('[EyeClaw] WebSocket client starting...')
      
      // 存储客户端引用，防止被垃圾回收
      ;(global as any).__eyeclaw_ws = wsClient
    } else {
      logger.warn('[EyeClaw] WebSocket not started: missing config (sdkToken, botId, serverUrl)')
    }
    
    // 打印启动信息
    const gatewayPort = api.config?.gateway?.port ?? 18789
    console.log('')
    console.log('╔═══════════════════════════════════════════════════════════════════════╗')
    console.log('║ EyeClaw Plugin 已启动                                                ║')
    console.log('╠═══════════════════════════════════════════════════════════════════════╣')
    console.log(`║ HTTP 端点: POST http://127.0.0.1:${gatewayPort}/eyeclaw/chat         ║`)
    console.log(`║ WebSocket: ${config.serverUrl ? '已配置' : '未配置'}                                            ║`)
    console.log(`║ SDK Token: ${config.sdkToken ? config.sdkToken.substring(0, 8) + '...' : '未配置'}                                          ║`)
    console.log('╚═══════════════════════════════════════════════════════════════════════╝')
    console.log('')
  },
}

export default eyeclawPlugin

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
      sdkToken: rawConfig?.sdkToken as string || '',
      botId: rawConfig?.botId ? String(rawConfig.botId) : '',
      serverUrl: rawConfig?.serverUrl as string || '',
    }
    
    // 获取 Gateway 端口
    const gatewayPort = api.config?.gateway?.port ?? 18789
    
    // 配置获取函数
    const getConfig = () => config
    const getState = () => ({
      config,
      gatewayPort,
    })
    
    // 1. 注册 HTTP 处理器（SSE 流式）
    if (typeof api.registerHttpHandler === 'function') {
      api.registerHttpHandler(createHttpHandler(api, getConfig))
      logger.info('[EyeClaw] HTTP handler registered: /eyeclaw/*')
    }
    
    // 2. 注册 WebSocket 服务
    if (typeof api.registerService === 'function') {
      api.registerService({
        id: 'eyeclaw-websocket',
        start: () => {
          if (!config.sdkToken || !config.botId || !config.serverUrl) {
            logger.warn('[EyeClaw] WebSocket not started: missing config (sdkToken, botId, serverUrl)')
            return
          }
          
          const wsClient = new EyeClawWebSocketClient(api, config, getState)
          wsClient.start()
          
          // 存储客户端引用，防止被垃圾回收
          ;(global as any).__eyeclaw_ws = wsClient
          
          // 打印启动信息
          console.log('')
          console.log('╔═══════════════════════════════════════════════════════════════════════╗')
          console.log('║ EyeClaw Plugin 已启动                                                ║')
          console.log('╠═══════════════════════════════════════════════════════════════════════╣')
          console.log(`║ HTTP 端点: POST http://127.0.0.1:${gatewayPort}/eyeclaw/chat         ║`)
          console.log(`║ WebSocket: ${config.serverUrl ? '已配置' : '未配置'}                                            ║`)
          console.log(`║ SDK Token: ${config.sdkToken ? config.sdkToken.substring(0, 8) + '...' : '未配置'}                                          ║`)
          console.log('╚═══════════════════════════════════════════════════════════════════════╝')
          console.log('')
          
          logger.info('[EyeClaw] WebSocket service started')
        },
        stop: () => {
          const wsClient = (global as any).__eyeclaw_ws
          if (wsClient) {
            wsClient.stop()
            delete (global as any).__eyeclaw_ws
          }
          logger.info('[EyeClaw] WebSocket service stopped')
        },
      })
    } else {
      logger.warn('[EyeClaw] registerService API not available, WebSocket will not start')
    }
  },
}

export default eyeclawPlugin

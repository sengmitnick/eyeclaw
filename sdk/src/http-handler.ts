/**
 * EyeClaw SDK - OpenClaw HTTP Handler Plugin
 * 
 * 直接注册 HTTP 端点，实现真正的 SSE 流式转发
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import type { EyeClawConfig } from './types.js'

/**
 * 读取 JSON 请求体
 */
async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8')
        resolve(body ? JSON.parse(body) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', (e) => reject(e))
  })
}

/**
 * 验证 Authorization 头
 */
function verifyAuth(authHeader: string | string[] | undefined, expectedToken: string): boolean {
  if (!expectedToken) return true
  const header = Array.isArray(authHeader) ? authHeader[0] : authHeader
  if (!header) return false
  if (header.startsWith('Bearer ')) return header.slice(7) === expectedToken
  return header === expectedToken
}

/**
 * 格式化 SSE 响应
 */
function formatSSE(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * 创建 HTTP 处理器
 */
export function createHttpHandler(api: OpenClawPluginApi, getConfig: () => EyeClawConfig) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/eyeclaw/')) return false
    
    const logger = api.logger
    const config = getConfig()
    
    // 验证鉴权
    const authHeader = req.headers.authorization
    if (!verifyAuth(authHeader, config.sdkToken || '')) {
      logger.warn('[EyeClaw] Unauthorized request')
      res.statusCode = 401
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Unauthorized' }))
      return true
    }
    
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Allow', 'POST')
      res.end('Method Not Allowed')
      return true
    }
    
    try {
      const body = await readJsonBody(req)
      const { message, session_id, stream_id } = body
      
      if (!message) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Missing required field: message' }))
        return true
      }
      
      logger.info(`[EyeClaw] Chat: ${message.substring(0, 50)}...`)
      
      // SSE 响应头
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      
      // 获取 Gateway 配置
      const gatewayPort = api.config?.gateway?.port ?? 18789
      const gatewayToken = api.config?.gateway?.auth?.token
      const sessionKey = session_id ? `eyeclaw:${session_id}` : 'eyeclaw:default'
      
      // 调用 OpenClaw
      const openclawUrl = `http://127.0.0.1:${gatewayPort}/v1/chat/completions`
      const openclawBody = {
        model: 'openclaw:main',
        stream: true,
        messages: [{ role: 'user', content: message }],
        user: sessionKey,
      }
      
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (gatewayToken) headers['Authorization'] = `Bearer ${gatewayToken}`
      
      logger.info(`[EyeClaw] Calling OpenClaw: ${openclawUrl}`)
      
      const openclawResponse = await fetch(openclawUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(openclawBody),
      })
      
      if (!openclawResponse.ok) {
        const errorText = await openclawResponse.text()
        throw new Error(`OpenClaw API error: ${openclawResponse.status} - ${errorText}`)
      }
      
      const reader = openclawResponse.body?.getReader()
      if (!reader) throw new Error('No response body')
      
      const decoder = new TextDecoder()
      let buffer = ''
      const currentStreamId = stream_id || Date.now().toString()
      
      res.write(formatSSE('stream_start', { stream_id: currentStreamId }))
      
      // 保活
      const keepaliveInterval = setInterval(() => { try { res.write(': keepalive\n\n') } catch { clearInterval(keepaliveInterval) } }, 7000)
      
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data: ')) continue
            const data = trimmed.slice(6)
            if (data === '[DONE]') continue
            
            try {
              const chunk = JSON.parse(data)
              const content = chunk.choices?.[0]?.delta?.content
              if (content) {
                res.write(formatSSE('stream_chunk', { stream_id: currentStreamId, content }))
              }
            } catch { /* ignore */ }
          }
        }
      } finally {
        clearInterval(keepaliveInterval)
      }
      
      res.write(formatSSE('stream_end', { stream_id: currentStreamId }))
      res.end()
      logger.info(`[EyeClaw] Completed: ${currentStreamId}`)
      return true
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error(`[EyeClaw] Error: ${errorMsg}`)
      res.write(formatSSE('stream_error', { error: errorMsg }))
      res.end()
      return true
    }
  }
}

/**
 * 插件配置 Schema
 */
export const eyeclawConfigSchema = {
  safeParse: (value: unknown) => {
    // 允许空配置
    if (!value || typeof value !== 'object') {
      return { success: true, data: {} }
    }
    return { success: true, data: value }
  },
  jsonSchema: {
    type: 'object',
    properties: {
      sdkToken: { type: 'string', description: 'EyeClaw SDK Token' },
      botId: { 
        oneOf: [
          { type: 'string' },
          { type: 'number' }
        ],
        description: 'Bot ID in EyeClaw Rails app' 
      },
      serverUrl: { type: 'string', description: 'EyeClaw Rails server URL' },
    },
  },
}

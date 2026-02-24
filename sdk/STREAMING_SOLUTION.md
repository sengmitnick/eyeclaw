# OpenClaw Streaming Solution

## 根本问题

WeCom 插件使用的是 **OpenClaw 内部 API**：
```javascript
// WeCom 插件 - 使用内部 API（真正的流式）
await core.reply.dispatchReplyWithBufferedBlockDispatcher({
  ctx: ctxPayload,
  cfg: config,
  dispatcherOptions: {
    deliver: async (payload, info) => {
      // LLM 每生成一块文本，就实时调用这个回调
      await deliverWecomReply({ payload, senderId, streamId })
    }
  }
})
```

而我们的 SDK 使用的是 **CLI**（无流式）：
```javascript
// 我们的 SDK - 使用 CLI（无流式）
spawn('openclaw', ['agent', '--message', message])
```

## 解决方案

### 方案：使用 OpenClaw Gateway WebSocket API

OpenClaw Gateway 提供 WebSocket API 来接收流式响应：

```bash
# 启动 Gateway 时开启 WebSocket
openclaw gateway start --ws-log compact

# 或者查看 Gateway 的 WebSocket 端点
```

### 实现思路

**选项 1：Plugin SDK 应该暴露内部 API**

联系 OpenClaw 团队，让 Plugin SDK 暴露 `core.reply.dispatchReplyWithBufferedBlockDispatcher` 方法。

**选项 2：使用 Gateway WebSocket 直连**

```typescript
// 不使用 spawn('openclaw agent')
// 而是直接连接 Gateway WebSocket

import WebSocket from 'ws'

class OpenClawGatewayClient {
  constructor(gatewayUrl: string, botId: string, token: string) {
    this.ws = new WebSocket(gatewayUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
  }

  async sendMessage(message: string, onChunk: (chunk: string) => void) {
    // 通过 WebSocket 发送消息
    this.ws.send(JSON.stringify({
      type: 'message',
      botId: this.botId,
      message
    }))

    // 通过 WebSocket 接收流式响应
    this.ws.on('message', (data) => {
      const event = JSON.parse(data.toString())
      if (event.type === 'chunk' && event.content) {
        onChunk(event.content)
      }
    })
  }
}
```

**选项 3：直接调用 LLM SDK（最简单）**

在 SDK 中直接集成 OpenAI/Anthropic 的流式 API：

```typescript
import OpenAI from 'openai'

class OpenClawLLMClient {
  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async *streamChat(message: string): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: message }],
      stream: true
    })

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        yield content
      }
    }
  }
}
```

然后在 channel.ts 中：
```typescript
client.setSendAgentCallback(async (message: string) => {
  const streamId = Date.now().toString()
  
  // 发送 stream_start
  client.sendStreamChunk('stream_start', streamId, '')
  
  // 直接使用 LLM 流式 API
  for await (const chunk of llmClient.streamChat(message)) {
    client.sendStreamChunk('stream_chunk', streamId, chunk)
  }
  
  // 发送 stream_end
  client.sendStreamChunk('stream_end', streamId, '')
})
```

## 推荐

**选项 3（直接调用 LLM SDK）最简单可行**，因为：
1. 不依赖 OpenClaw 内部 API
2. 真正的流式输出
3. 容易实现和维护

需要配置：
- `LLM_API_KEY` - LLM 提供商的 API Key
- `LLM_MODEL` - 使用的模型

## 待验证

1. OpenClaw Gateway 的 WebSocket API 端点和协议
2. Plugin SDK 是否计划暴露内部流式 API
3. 直接调用 LLM SDK 是否有其他问题（如工具调用、会话管理）

## 参考

- WeCom 插件源码：`/tmp/openclaw-plugin-wecom/index.js` 第 1534 行
- OpenClaw Gateway：`openclaw gateway --help`
- OpenClaw 文档：https://docs.openclaw.ai

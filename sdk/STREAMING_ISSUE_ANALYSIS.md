# OpenClaw Streaming Issue - Root Cause Analysis

## 问题确认

通过分析日志和 `openclaw agent --help` 输出，我们确认了：

### ❌ 问题：`openclaw agent` CLI **不支持实时流式输出**

从日志时间戳可以看出：
```
04:30:48 - 收到请求
04:30:55 - 所有 chunks 几乎同时到达（7秒后）
```

### 原因分析

1. **`openclaw agent` 是批处理命令**
   - 接收消息 → 等待 LLM 完全响应 → 一次性输出结果
   - `--json` 标志只是改变输出格式，不是启用流式
   - **没有 `--stream` 参数**

2. **当前SDK架构错误**
   ```typescript
   // 错误的做法：直接调用 CLI 并期望流式输出
   const agentProcess = spawn('openclaw', ['agent', '--message', message])
   agentProcess.stdout?.on('data', (data) => {
     // 这里收到的是完整响应，不是逐token流式
   })
   ```

## 正确的流式方案

### 方案 1：使用 OpenClaw Gateway 的 Channel Delivery（推荐）

OpenClaw Gateway 已经支持 `eyeclaw` channel，应该使用 **双向通道机制**：

```typescript
// 触发 Agent（通过 --deliver 参数）
spawn('openclaw', [
  'agent',
  '--message', message,
  '--channel', 'eyeclaw',   // 指定通过 eyeclaw channel 返回
  '--deliver',              // 启用 delivery 机制
  '--local'
])

// Agent 的流式响应会通过 OpenClaw Gateway 的 Channel Plugin 推送回来
// SDK 需要实现接收机制
```

#### 工作流程

```
┌─────────────┐      ┌──────────────────┐      ┌─────────────┐
│  Dashboard  │─────▶│   EyeClaw SDK    │─────▶│   OpenClaw  │
│  (Browser)  │      │  (Channel Plugin)│      │   Gateway   │
└─────────────┘      └──────────────────┘      └─────────────┘
       ▲                       ▲                        │
       │                       │                        ▼
       │                       │                ┌──────────────┐
       │                       └────────────────│ OpenClaw     │
       │                         (streaming)    │ Agent        │
       │                                        │ (LLM call)   │
       └────────────────────────────────────────┴──────────────┘
            (flow back through channel delivery)
```

### 方案 2：使用 OpenClaw 的 HTTP API（如果有）

检查 OpenClaw 是否提供 HTTP streaming API：
```bash
openclaw gateway --help
# 查看是否有 HTTP/WebSocket 端点
```

### 方案 3：直接调用 LLM SDK（绕过 OpenClaw Agent）

如果 OpenClaw Agent 不支持流式，可以：
```typescript
// 在 SDK 中直接集成 LLM SDK (如 OpenAI)
import OpenAI from 'openai'

const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: [{role: 'user', content: message}],
  stream: true
})

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content
  if (content) {
    client.sendStreamChunk('stream_chunk', streamId, content)
  }
}
```

## 需要的信息

### 1. OpenClaw Channel Plugin 的 Delivery 机制

需要查阅 OpenClaw 文档或源码，了解：
- Channel Plugin 如何接收 Agent 的 `--deliver` 输出？
- 是否有回调函数或事件监听器？
- 数据格式是什么？

### 2. OpenClaw Gateway 的流式能力

```bash
# 测试 OpenClaw Gateway 是否支持流式
openclaw agent --message "test" --channel eyeclaw --deliver --local

# 查看 OpenClaw Gateway 日志，看是否有流式输出
```

### 3. Channel Plugin API

查看 `openclaw/plugin-sdk` 的 TypeScript 类型定义：
```typescript
interface ChannelPlugin {
  // 是否有接收 delivered messages 的接口？
  onMessage?: (message: Message) => void
  onStreamChunk?: (chunk: Chunk) => void
}
```

## 推荐行动步骤

### Step 1: 验证 OpenClaw 的流式能力

```bash
# 1. 启动 OpenClaw Gateway
openclaw gateway start

# 2. 在另一个终端测试流式输出
openclaw agent --message "讲一个长故事" --channel eyeclaw --deliver --local

# 3. 观察 Gateway 日志，看是否有逐步推送的迹象
```

### Step 2: 检查 Channel Plugin 文档

访问 OpenClaw 文档：
- https://docs.openclaw.ai/plugins
- https://docs.openclaw.ai/channels
- https://github.com/openclaw/openclaw (源码)

查找 `ChannelPlugin` 接口的详细说明。

### Step 3: 联系 OpenClaw 团队

如果文档不清楚，直接询问：
> "How can a channel plugin receive streaming responses from `openclaw agent --channel mychannel --deliver`? Is there an `onStreamChunk` callback or similar?"

### Step 4: 实现正确的流式机制

根据上述调研结果，修改 SDK 实现。

## 临时解决方案（非理想）

如果 OpenClaw 确实不支持流式，可以：

1. **客户端模拟流式**
   ```typescript
   // 等待完整响应后，逐字符"模拟"流式发送
   const fullResponse = await getFullResponse()
   for (const char of fullResponse) {
     client.sendStreamChunk('stream_chunk', streamId, char)
     await sleep(20) // 模拟打字效果
   }
   ```

2. **在前端实现流式UI**
   - 后端发送完整响应
   - 前端接收后逐字显示

但这些都不是真正的流式，只是 UX 改进。

## 总结

**核心问题**：`openclaw agent` CLI 是批处理工具，不支持真正的流式输出。

**解决方向**：
1. ✅ 使用 OpenClaw Gateway 的 Channel Delivery 机制（如果支持）
2. ✅ 使用 OpenClaw HTTP API（如果有）
3. ✅ 直接集成 LLM SDK，绕过 OpenClaw Agent
4. ❌ 继续使用 CLI 并期望流式（不可行）

**下一步**：调研 OpenClaw 的 Channel Plugin Delivery 机制。

# 流式丢包根本原因分析

## 🔍 问题复现

**现象：**
- OpenClaw 输出完整内容："嘿。🦞\n\n有什么事吗？"
- 眼镜只收到："嘿。🦞 有"
- StreamTrace 显示：
  - SDK chunks: 2
  - SSE chunks: 2
  - 内容相同但都很短

## 📊 完整数据流

```
OpenClaw
  ↓ (HTTP SSE)
HTTP Handler (sdk/src/http-handler.ts)
  ↓ (SSE events: stream_chunk)
WebSocket Client (sdk/src/websocket-client.ts)
  ↓ (WebSocket: stream_chunk messages)
BotChannel (app/channels/bot_channel.rb)
  ↓ (ActionCable broadcast: rokid_sse_{bot_id}_{session_id})
RokidSseController (app/controllers/rokid_sse_controller.rb)
  ↓ (Rack hijack: SSE to 眼镜)
眼镜 (Rokid)
```

## 🐛 根本原因假设

### 假设 1: ActionCable 订阅时机问题 ⚠️

**时序分析：**

```ruby
# RokidSseController 代码顺序
Rails.logger.info "[RokidSSE] Broadcasting command to bot_#{bot.id}_commands"
ActionCable.server.broadcast("bot_#{bot.id}_commands", command_payload)  # 1️⃣ 先广播命令

# ...

subscription_channel = "rokid_sse_#{bot.id}_#{message_id}"
cable = ActionCable.server.pubsub
message_queue = Queue.new

callback = ->(data) { ... }

cable.subscribe(subscription_channel, callback)  # 2️⃣ 后订阅频道
Rails.logger.info "[RokidSSE] Subscribed to channel: #{subscription_channel}"
```

**问题：**
1. Rails 先广播命令到 `bot_#{bot.id}_commands`
2. SDK 立即收到命令，开始调用 OpenClaw
3. OpenClaw 快速返回第一个 chunk
4. SDK 通过 WebSocket 发送 `stream_chunk` 给 BotChannel
5. BotChannel 广播到 `rokid_sse_#{bot.id}_#{message_id}`
6. **但此时 RokidSseController 还没有订阅！**
7. 前几个 chunks 丢失了！

**验证方法：**
添加日志，检查：
- SDK 发送第一个 chunk 的时间
- RokidSseController 订阅成功的时间
- 时间差如果很小（< 100ms），就会丢包

### 假设 2: OpenClaw 返回速度太快 ⚠️

如果 OpenClaw 使用缓存或者返回预设回复，可能在几十毫秒内就完成：

```
T=0ms:    Rails 广播命令
T=10ms:   SDK 收到命令
T=20ms:   SDK 调用 OpenClaw
T=30ms:   OpenClaw 返回第一个 chunk
T=40ms:   SDK 发送 chunk #0
T=50ms:   BotChannel 广播 chunk #0
T=60ms:   OpenClaw 返回第二个 chunk  
T=70ms:   SDK 发送 chunk #1
T=80ms:   BotChannel 广播 chunk #1
T=90ms:   OpenClaw 发送 stream_end
T=100ms:  SDK 发送 stream_end
T=150ms:  RokidSseController 完成订阅 ❌ 太晚了！
```

### 假设 3: ActionCable Redis 传输延迟

ActionCable 使用 pubsub 机制（Redis 或内存），可能有微小延迟。

## 🔧 解决方案

### 方案 A: 提前订阅（推荐）⭐

在广播命令**之前**订阅频道：

```ruby
# 1️⃣ 先订阅
subscription_channel = "rokid_sse_#{bot.id}_#{message_id}"
cable = ActionCable.server.pubsub
message_queue = Queue.new

callback = ->(data) { ... }
cable.subscribe(subscription_channel, callback)
Rails.logger.info "[RokidSSE] Subscribed to channel: #{subscription_channel}"

# 2️⃣ 等待订阅确认（可选，增加稳定性）
sleep 0.05  # 50ms 足够让订阅生效

# 3️⃣ 再广播命令
Rails.logger.info "[RokidSSE] Broadcasting command to bot_#{bot.id}_commands"
ActionCable.server.broadcast("bot_#{bot.id}_commands", command_payload)
```

**优点：**
- 确保在第一个 chunk 到达前已经订阅
- 简单直接，改动最小

**缺点：**
- 增加 50ms 延迟（但用户感知不到）

### 方案 B: SDK 延迟发送

让 SDK 在收到命令后等待一小段时间再调用 OpenClaw：

```typescript
// WebSocket Client
private async handleCommand(payload: WebSocketMessage) {
  // ...
  
  // 等待 Rails 完成订阅（给 100ms 缓冲）
  await new Promise(resolve => setTimeout(resolve, 100))
  
  await this.processWithOpenClaw(userMessage, sessionId, openclawSessionId)
}
```

**优点：**
- Rails 端无需改动

**缺点：**
- 增加响应延迟
- 治标不治本（如果 Rails 订阅更慢，还是会丢包）

### 方案 C: BotChannel 缓存机制

让 BotChannel 缓存最近 N 秒的消息：

```ruby
# 全局缓存
@@message_cache = {}

def stream_chunk(data)
  # ...
  
  # 缓存消息（保留 5 秒）
  cache_key = "rokid_sse_#{@bot.id}_#{session_id}"
  @@message_cache[cache_key] ||= []
  @@message_cache[cache_key] << {
    data: data,
    timestamp: Time.current
  }
  
  # 广播
  ActionCable.server.broadcast(...)
  
  # 清理过期缓存
  @@message_cache[cache_key].reject! { |m| Time.current - m[:timestamp] > 5 }
end
```

然后在 RokidSseController 订阅时，先读取缓存：

```ruby
# 订阅后立即读取缓存
cache_key = "rokid_sse_#{bot.id}_#{message_id}"
cached_messages = BotChannel.get_cached_messages(cache_key)
cached_messages.each { |msg| message_queue << msg }
```

**优点：**
- 完美解决竞态问题
- 可以处理任意延迟

**缺点：**
- 实现复杂
- 内存开销

## 🎯 推荐实施顺序

1. **立即实施方案 A**（提前订阅 + 小延迟）
2. 添加详细日志验证假设
3. 如果仍有问题，考虑方案 C

## 📝 验证计划

修改后，检查日志：
```
[RokidSSE] Subscribed to channel: rokid_sse_1_MESSAGE_ID
[RokidSSE] Broadcasting command to bot_1_commands
[BotChannel] Received stream_chunk #0 for session MESSAGE_ID: 嘿。
[RokidSSE] Received broadcast on rokid_sse_1_MESSAGE_ID
[RokidSSE] Received stream chunk #0: 嘿。
[BotChannel] Received stream_chunk #1 for session MESSAGE_ID: 🦞
[RokidSSE] Received broadcast on rokid_sse_1_MESSAGE_ID
[RokidSSE] Received stream chunk #1: 🦞
```

预期结果：
- 所有 chunks 都被接收
- SDK content 和 SSE content 长度一致
- 眼镜收到完整内容

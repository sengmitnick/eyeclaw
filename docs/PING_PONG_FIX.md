# Ping/Pong 机制修复说明

## 问题描述

Rails 日志中出现警告：
```
Received unrecognized command in {"type"=>"pong"}
```

## 根本原因

SDK 在响应 WebSocket 协议级别的 ping 时，手动发送了 `{ type: 'pong' }` 消息。这导致：

1. SDK 收到协议级 ping（`message.type === 'ping'`）
2. SDK 手动发送 `{ type: 'pong' }`
3. ActionCable Connection 层的 `execute_command` 方法收到这个消息
4. 因为消息缺少 `command` 字段（不是 `subscribe`/`unsubscribe`/`message`），报错

## Ping/Pong 的两个层次

### 1. WebSocket 协议级别 (RFC 6455)

**特点：**
- 操作码：ping (0x9), pong (0xA)
- **自动处理**：浏览器/WebSocket 客户端自动响应 ping 帧
- **应用层不可见**：不需要（也不应该）手动处理

**Rails ActionCable 发送：**
ActionCable 服务器会定期发送协议级 ping 帧来检测连接存活。

**正确的处理方式：**
```typescript
// 协议级 ping 无需手动响应，浏览器自动处理
if (message.type === 'ping') {
  this.api.logger.debug('[EyeClaw] Received protocol-level ping (auto-handled by WebSocket)')
  return
}
```

### 2. 应用层 Ping/Pong (ActionCable Channel 方法)

**特点：**
- 通过 ActionCable 的 message command 调用 Channel 方法
- 用于应用层的状态同步和业务逻辑

**SDK 发送：**
```typescript
// 每 60 秒调用一次 BotChannel#ping 方法
this.send({
  command: 'message',
  identifier: channelIdentifier,
  data: JSON.stringify({
    action: 'ping',
    timestamp: new Date().toISOString(),
  }),
})
```

**Rails 处理：**
```ruby
# app/channels/bot_channel.rb
def ping(data)
  @bot.ping!
  
  transmit({
    type: 'pong',
    timestamp: Time.current.iso8601
  })
end
```

**SDK 接收：**
```typescript
// 处理 Rails BotChannel 的 pong 响应
if (message.type === 'pong') {
  this.api.logger.debug('[EyeClaw] Received pong from server')
  return
}
```

## 修复内容

**修改文件：** `sdk/src/websocket-client.ts`

**Before:**
```typescript
// Ping/pong (协议级别的 ping，直接响应 pong)
if (message.type === 'ping') {
  this.send({ type: 'pong' })  // ❌ 错误：手动发送 pong
  return
}
```

**After:**
```typescript
// Ping/pong (WebSocket 协议级别的 ping 由浏览器自动响应，无需手动处理)
if (message.type === 'ping') {
  this.api.logger.debug('[EyeClaw] Received protocol-level ping (auto-handled by WebSocket)')
  return
}
```

## 验证

修复后，不再出现 "Received unrecognized command" 警告，同时保持以下功能：

1. ✅ WebSocket 连接保活（协议级 ping/pong 自动处理）
2. ✅ 应用层心跳（BotChannel#ping 方法每 60 秒调用）
3. ✅ Bot 在线状态更新（`@bot.ping!` 更新 last_seen_at）

## 参考

- [RFC 6455 - WebSocket Protocol (Section 5.5.2 Ping, 5.5.3 Pong)](https://datatracker.ietf.org/doc/html/rfc6455#section-5.5.2)
- [ActionCable Connection Subscriptions](https://github.com/rails/rails/blob/main/actioncable/lib/action_cable/connection/subscriptions.rb)
- [ActionCable Guides](https://guides.rubyonrails.org/action_cable_overview.html)

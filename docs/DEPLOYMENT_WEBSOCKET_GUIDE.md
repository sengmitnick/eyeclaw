# WebSocket 部署断连解决方案

## 问题描述

每次网站部署时，所有连接的 Bot 和本地 OpenClaw 实例会断开连接。这是因为 Puma 进程重启时，所有 WebSocket 连接被强制关闭。

## 解决方案

### 1. SDK 增强重连机制 (`sdk/src/websocket-client.ts`)

- **指数退避重连**: 延迟从 1s → 2s → 4s → 8s → 16s → 30s (上限)
- **随机抖动**: ±25% 随机延迟，避免多个客户端同时重连
- **无限重试**: 超过最大次数后仍持续尝试（每 60 秒）
- **最大重试次数**: 提升到 10 次

### 2. Bot 状态智能恢复 (`app/models/bot.rb`)

**核心思路**: 断连时立即标记 offline，依赖 SDK 心跳来恢复 online

- **断连时**: 立即标记 `offline`（包括部署断连和真正断连）
- **SDK 重连时**: 通过 `ping!` 方法自动恢复 `online` 状态

### 场景分析

| 场景 | Bot 状态变化 | 恢复方式 |
|------|-------------|---------|
| 部署断连 | online → offline | SDK 几秒内重连 → ping! → online |
| 电脑关机 | online → offline | SDK 持续重连失败 → 保持 offline |

**为什么这样设计**:
- 部署断连：SDK 立即重连（秒级），用户无感知
- 真正断开：SDK 不会重连，保持 offline 状态正确

## 重连流程

```
部署/断连发生
    ↓
BotChannel#unsubscribed → Bot#disconnect! → status = 'offline'
    ↓
SDK 检测到断连 → 指数退避重连 (1s, 2s, 4s...)
    ↓
[成功] SDK 重新连接 → BotChannel#subscribed → Bot#connect!
    ↓
SDK 发送 ping → Bot#ping! → status = 'online'
```

## SDK 心跳机制

SDK 每 60 秒发送一次 ping：

```typescript
// sdk/src/websocket-client.ts
private startPing() {
  this.pingInterval = setInterval(() => {
    this.send({ command: 'message', identifier: ..., data: JSON.stringify({ action: 'ping' }) })
  }, 60000)
}
```

Rails 端处理：

```ruby
# app/channels/bot_channel.rb
def ping(data)
  @bot.ping!  # 自动恢复 online 状态
  transmit({ type: 'pong', timestamp: Time.current.iso8601 })
end
```

## 部署最佳实践

### 推荐部署流程

1. **使用 Puma tmp_restart** (已启用)

   ```ruby
   # config/puma.rb
   plugin :tmp_restart  # 已配置
   ```

2. **Railway/Render 等平台**

   平台会自动发送 SIGTERM，Puma 会优雅处理：
   - 新请求不再发送到旧进程
   - 等待现有连接完成

3. **健康检查配置**

   确保负载均衡器的健康检查正确：
   - 间隔: 10-30 秒
   - 超时: 5 秒
   - 不健康阈值: 3 次

## 监控

```ruby
# 查看在线 Bot
Bot.online

# 查看离线 Bot  
Bot.offline

# 查看活跃会话（心跳 5 分钟内的）
BotSession.active
```

## 注意事项

1. **断连立即显示 offline**: 这是预期行为，不是 bug
2. **部署后自动恢复**: SDK 会在几秒内重连，状态恢复 online
3. **真正断开保持 offline**: 电脑关机等真正断连会保持 offline

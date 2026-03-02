# WebSocket 部署断连解决方案

## 问题描述

每次网站部署时，所有连接的 Bot 和本地 OpenClaw 实例会断开连接。这是因为 Puma 进程重启时，所有 WebSocket 连接被强制关闭。

## 解决方案

### 1. SDK 增强重连机制 (`sdk/src/websocket-client.ts`)

#### 部署感知加速重连（新增）
- **部署检测**：通过 `wasConnected` 和 `lastConnectedAt` 检测是否是部署导致的断连
- **立即重连**：检测到部署后，100ms 内立即重连（而非等待指数退避）
- **快速心跳**：重连成功后立即发送 ping 恢复 Bot 在线状态

#### 指数退避重连
- **延迟策略**：1s → 2s → 4s → 8s → 16s → 30s (上限)
- **随机抖动**：±25% 随机延迟，避免多个客户端同时重连
- **无限重试**：超过最大次数后仍持续尝试（每 30 秒）
- **最大重试次数**：10 次

#### 健康检查重连（新增）
- 重连前先检查服务器健康状态
- 如果服务器未就绪，等待后再重试
- 避免无效的 WebSocket 连接尝试

#### 定时器管理（新增）
- 防止重复调度重连
- 正确清理所有定时器，避免内存泄漏
- stop() 方法清理所有资源

### 2. Bot 状态智能恢复 (`app/models/bot.rb`)

**核心思路**: 断连时立即标记 offline，依赖 SDK 心跳来恢复 online

- **断连时**: 立即标记 `offline`（包括部署断连和真正断连）
- **SDK 重连时**: 通过 `ping!` 方法自动恢复 `online` 状态
- **状态广播**: 重连后广播 `bot_reconnected` 事件通知所有监听者

### 3. 部署最佳实践

#### 使用 Puma tmp_restart

```ruby
# config/puma.rb
plugin :tmp_restart  # 已配置
```

#### Railway 部署优化

确保 Railway 部署时使用优雅重启：
- Railway 默认会发送 SIGTERM，Puma 会优雅处理
- 配合 tmp_restart 插件可实现零断连部署

#### 健康检查配置

确保负载均衡器的健康检查正确：
- 间隔: 10-30 秒
- 超时: 5 秒
- 不健康阈值: 3 次

## 重连流程

```
部署/断连发生
    ↓
BotChannel#unsubscribed → Bot#disconnect! → status = 'offline'
    ↓
SDK 检测到断连 → 部署感知判断
    ↓
[部署断连] → 100ms 立即重连
[网络问题] → 指数退避重连 (1s, 2s, 4s...)
    ↓
[成功] SDK 重新连接 → BotChannel#subscribed → Bot#connect!
    ↓
SDK 发送 ping → Bot#ping! → status = 'online' + 广播 bot_reconnected
```

## SDK 心跳机制

SDK 每 60 秒发送一次 ping：

```typescript
// sdk/src/websocket-client.ts
private startPing() {
  this.pingInterval = setInterval(() => {
    // 调用 Rails BotChannel 的 ping 方法
    this.send({
      command: 'message',
      identifier: channelIdentifier,
      data: JSON.stringify({ action: 'ping' })
    })
  }, 60000)
}
```

Rails 端处理：

```ruby
# app/channels/bot_channel.rb
def ping(data)
  @bot.ping!  # 自动恢复 online 状态 + 广播事件
  transmit({ type: 'pong', timestamp: Time.current.iso8601 })
end
```

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
2. **部署后自动恢复**: SDK 会在 100ms-2s 内重连，状态自动恢复 online
3. **真正断开保持 offline**: 电脑关机等真正断连会保持 offline
4. **健康检查辅助**: 重连前会先检查服务器健康状态，提高成功率

# 流式丢包修复总结 - v2026.02.27

## 🐛 问题描述

**现象：**
- OpenClaw 输出完整内容："嘿。🦞\n\n有什么事吗？"
- 眼镜只收到："嘿。🦞 有"
- StreamTrace 显示 SDK 和 SSE 的内容都很短，只有前两个 chunks

**用户报告：**
> 嘿。🦞
> 有什么事吗？
> 
> 这是在 openclaw 的完整输出，但是在眼镜只有： 嘿。🦞 有

## 🔍 根本原因

**竞态条件（Race Condition）：**

1. Rails 先广播命令到 `bot_#{bot_id}_commands`
2. SDK 立即收到命令，调用 OpenClaw
3. OpenClaw 快速返回（如果使用缓存或预设回复，可能在几十毫秒内完成）
4. SDK 通过 WebSocket 发送 `stream_chunk` 给 BotChannel
5. BotChannel 广播到 `rokid_sse_#{bot_id}_#{message_id}`
6. **此时 RokidSseController 还没有订阅该频道！** ❌
7. 前几个快速到达的 chunks 丢失

**时序图：**
```
T=0ms:    Rails 广播命令
T=10ms:   SDK 收到命令
T=20ms:   SDK 调用 OpenClaw
T=30ms:   OpenClaw 返回 chunk #0
T=40ms:   SDK 发送 chunk #0
T=50ms:   BotChannel 广播 chunk #0 ❌ Rails 还没订阅
T=60ms:   OpenClaw 返回 chunk #1  
T=70ms:   SDK 发送 chunk #1
T=80ms:   BotChannel 广播 chunk #1 ❌ Rails 还没订阅
T=90ms:   OpenClaw 发送 stream_end
T=100ms:  SDK 发送 stream_end
T=150ms:  RokidSseController 完成订阅 ✅ 太晚了！
```

## ✅ 解决方案

### 修复：先订阅，后广播

**修改 `app/controllers/rokid_sse_controller.rb`：**

```ruby
# ❌ 旧代码（有问题）
ActionCable.server.broadcast("bot_#{bot.id}_commands", command_payload)
# ...
cable.subscribe(subscription_channel, callback)

# ✅ 新代码（已修复）
cable.subscribe(subscription_channel, callback)
Rails.logger.info "[RokidSSE] ✅ Subscribed to channel: #{subscription_channel}"
sleep 0.05  # 等待 50ms 让订阅生效
ActionCable.server.broadcast("bot_#{bot.id}_commands", command_payload)
```

**关键点：**
1. **先订阅**：确保在广播命令之前，RokidSseController 已经订阅了响应频道
2. **等待 50ms**：给 ActionCable 内部订阅机制一些时间完成
3. **后广播**：现在可以安全地广播命令，确保能接收到所有 chunks

### 修改的方法

1. `sse_hijack` (Rack hijacking 模式)
2. `sse_live` (ActionController::Live fallback 模式)

## 📊 修复后的预期效果

### 新的时序：
```
T=0ms:    Rails 订阅 rokid_sse_#{bot_id}_#{message_id}
T=50ms:   订阅生效
T=60ms:   Rails 广播命令
T=70ms:   SDK 收到命令
T=80ms:   SDK 调用 OpenClaw
T=90ms:   OpenClaw 返回 chunk #0
T=100ms:  SDK 发送 chunk #0
T=110ms:  BotChannel 广播 chunk #0 ✅ Rails 已订阅
T=115ms:  Rails 接收 chunk #0 ✅
T=120ms:  OpenClaw 返回 chunk #1
T=130ms:  SDK 发送 chunk #1
T=140ms:  BotChannel 广播 chunk #1 ✅
T=145ms:  Rails 接收 chunk #1 ✅
...
所有 chunks 都能正常接收！
```

### 验证要点：

1. **日志顺序：**
   ```
   [RokidSSE] ✅ Subscribed to channel: rokid_sse_1_MESSAGE_ID
   [RokidSSE] 🚀 Broadcasting command to bot_1_commands
   [BotChannel] Received stream_chunk #0 for session MESSAGE_ID
   [RokidSSE] Received broadcast on rokid_sse_1_MESSAGE_ID
   ```

2. **StreamTrace 应该显示：**
   - SDK chunks = N（完整数量）
   - SSE chunks = N（完整数量）
   - sdk_content = 完整内容
   - sse_content = 完整内容
   - status = completed（无异常）

3. **眼镜应该收到：**
   - 完整的 OpenClaw 响应
   - 无丢包、无截断

## 🚀 部署

**无需重启，代码热加载：**
- Rails 会自动重新加载 controller 代码
- 下一次请求将使用新代码

**验证：**
```bash
# 查看 Rails 日志
tail -f log/development.log | grep RokidSSE
```

## 📝 相关文件

- `app/controllers/rokid_sse_controller.rb` - 主修复
- `STREAM_LOSS_ROOT_CAUSE_ANALYSIS.md` - 详细分析
- `SDK_STREAM_SUMMARY_FIX_VERIFICATION.md` - SDK 兜底机制修复

## 🔗 关联问题

- ✅ 修复了 ActionCable 订阅时机导致的丢包
- ✅ SDK v2.3.13 已修复 stream_summary 不发送的问题（兜底机制）
- ✅ 双重保障：既修复了根本原因，又确保兜底机制能正常工作

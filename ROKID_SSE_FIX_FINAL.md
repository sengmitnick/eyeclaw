# Rokid SSE 流式问题修复总结

## 问题描述
Rokid SSE接口虽然使用了正确的SSE格式，且数据在前4-5秒内全部发送完成，但连接会一直等待60秒直到idle timeout才关闭。

## 根本原因
SDK的websocket-client.ts在SSE流读取完成后（`done: true`），**没有发送`stream_end`消息到Rails**，导致RokidSSE Controller一直等待stream_end事件，直到60秒idle timeout。

## 问题代码位置
`sdk/src/websocket-client.ts` 第232-234行：
```typescript
while (true) {
  const { done, value } = await reader.read()
  if (done) break  // ❌ 只是break，没有通知Rails流结束
```

## 修复方案
在SSE流读取完成时立即发送`stream_end`到Rails：
```typescript
while (true) {
  const { done, value } = await reader.read()
  if (done) {
    // ✅ 流结束，通知 Rails
    this.sendMessage('stream_end', { session_id: sessionId })
    break
  }
```

## 修复版本
**@eyeclaw/eyeclaw@2.3.7**

## 验证步骤
1. 更新本地SDK到2.3.7：
   ```bash
   npm update @eyeclaw/eyeclaw
   # 或
   openclaw plugin:install npm:@eyeclaw/eyeclaw@2.3.7
   ```

2. 重启OpenClaw

3. 测试SSE接口：
   ```bash
   bash test_rokid_sse.sh
   ```

4. 预期结果：
   - 所有chunks在4-5秒内发送完成
   - **连接立即关闭**（不再等待60秒）
   - 最后两个事件：
     ```
     event: message
     data: {"role":"agent",...,"is_finish":true}
     
     event: done
     data: {"role":"agent",...}
     ```

## 架构说明
1. Rokid → RokidSSE Controller (订阅 `rokid_sse_4_{message_id}`)
2. RokidSSE → broadcast到 `bot_4_commands`
3. SDK via WebSocket → 调用自己的HTTP handler → 调用OpenClaw
4. OpenClaw 返回SSE流 → SDK读取
5. SDK每个chunk → 发送`stream_chunk`到Rails
6. **SDK读取完成** → 发送`stream_end`到Rails ✅
7. BotChannel → broadcast `stream_end`到 `rokid_sse_4_{message_id}`
8. RokidSSE Controller → 收到stream_end → 关闭连接

## 其他修复
1. **Channel名称匹配**：RokidSSE Controller订阅 `rokid_sse_{bot_id}_{message_id}`，与BotChannel广播一致
2. **消息提取**：支持标准Rokid消息格式（直接有`content`字段）
3. **Puma配置**：development使用单worker模式确保ActionController::Live实时streaming

## 文件变更
- `sdk/src/websocket-client.ts` - 修复stream_end发送
- `sdk/package.json` - 版本更新到2.3.7
- `app/controllers/rokid_sse_controller.rb` - Channel订阅修复、消息提取支持
- `config/puma.rb` - 环境特定worker配置

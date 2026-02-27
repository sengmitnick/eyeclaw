# EyeClaw SDK v2.3.13 - Stream Summary Fix

## 📅 Release Date
2025-02-27

## 🐛 Bug Fixes

### Critical: Stream Summary Not Sent
**Problem:**
- SDK 在接收到 `stream_end` 事件后，没有立即发送 `stream_summary`
- 导致 Rails 后端无法检测丢包并补偿缺失内容
- 兜底机制失效

**Root Cause:**
```typescript
// 旧代码（有问题）
if (currentEvent === 'stream_end') {
    this.sendMessage('stream_end', { session_id: sessionId })
    // ❌ 没有发送 stream_summary，继续等待 reader.read()
}

// 外层循环继续等待，直到 reader 返回 done
while (true) {
    const { done, value } = await reader.read()
    if (done) {
        // ✅ 这里才发送 stream_summary，但可能永远不会执行到
        this.sendStreamSummary(sessionId)
        break
    }
}
```

**Solution:**
收到 `stream_end` 事件时，立即发送 `stream_summary` 并退出循环：

```typescript
if (currentEvent === 'stream_end') {
    streamEnded = true
    this.sendMessage('stream_end', { session_id: sessionId })
    this.sendStreamSummary(sessionId)  // ✅ 立即发送
    return  // ✅ 退出循环
}

// 兜底：如果循环正常结束但没有收到 stream_end 事件
if (!streamEnded) {
    this.sendMessage('stream_end', { session_id: sessionId })
    this.sendStreamSummary(sessionId)
}
```

## 🔍 Impact

### Before Fix
- `stream_summary` 可能永远不会发送
- Rails 后端无法检测丢包
- 用户可能收到不完整的响应

### After Fix
- 收到 `stream_end` 事件后，立即发送完整内容摘要
- Rails 后端可以检测丢包并补偿
- 兜底机制正常工作

## 📊 Testing

测试场景：
1. ✅ 正常流式响应（收到 stream_end 事件）
2. ✅ 异常流结束（没有收到 stream_end 事件）
3. ✅ 流式响应出错（收到 stream_error 事件）

预期结果：
- 所有场景下，`stream_summary` 都能正确发送
- Rails 后端能收到完整的 `total_content` 和 `total_chunks`

## 🚀 Upgrade Guide

更新 SDK：
```bash
cd sdk
npm version patch
npm run build
npm publish
```

在 OpenClaw 中更新插件：
```bash
# 在 OpenClaw 配置中更新版本
openclaw plugin update @eyeclaw/sdk
```

## 📝 Technical Details

### Modified Files
- `sdk/src/websocket-client.ts`
  - 添加 `streamEnded` 标志
  - 收到 `stream_end` 时立即发送摘要并退出
  - 添加兜底逻辑处理异常结束

### Behavior Changes
- **Breaking:** 无
- **Behavioral:** 流结束时会立即退出 SSE 解析循环（之前会继续等待）

## 🔗 Related Issues

- Fixes: Stream summary 不发送导致兜底机制失效
- Related: ROKID_SSE_FIX_FINAL.md

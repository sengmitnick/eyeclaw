# OpenClaw Streaming Fix - V2

## 问题确认

通过分析 WeCom 插件源码，发现了正确的流式实现方式：

### WeCom 插件的做法

```javascript
// WeCom Claw 内部插件 - 使用 Open API（真正的流式）
const core = runtime.channel;

await core.dispatchReplyWithBufferedBlockDispatcher({
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

### 我们的解决方案

更新 SDK 使用 `ctx.runtime.channel.dispatchReplyWithBufferedBlockDispatcher` API：

```typescript
// SDK 更新后 - 使用和 WeCom 插件相同的方式
await ctx.runtime.channel.dispatchReplyWithBufferedBlockDispatcher({
  ctx: {
    sessionKey: `eyeclaw:${streamKey}`,
    messageKey: `eyeclaw:${streamKey}:${streamId}`,
    peerKey: streamKey,
    message: {
      role: 'user',
      content: message,
      roleDetail: 'user',
    },
  },
  cfg: ctx.cfg,
  dispatcherOptions: {
    deliver: async (payload, info) => {
      const text = payload.text || ''
      if (text) {
        // 实时发送每个 chunk
        client.sendStreamChunk('stream_chunk', streamId, text)
      }
    },
    onError: async (error, info) => {
      client.sendStreamChunk('stream_error', streamId, error.message)
    },
  },
})
```

## 关键发现

1. **OpenClaw Plugin SDK 暴露了内部 API**
   - `ctx.runtime.channel.dispatchReplyWithBufferedBlockDispatcher` 
   - 这和 WeCom 插件使用的方式完全相同

2. **这是真正的流式**
   - LLM 每生成一块文本，就会调用 `deliver` 回调
   - 不是等待完整响应后一次性发送

## 测试方法

1. **重新安装 SDK 到 OpenClaw**
   ```bash
   cd sdk
   openclaw plugins install .
   ```

2. **启动 OpenClaw Gateway**
   ```bash
   openclaw gateway start
   ```

3. **发送测试消息**
   - 通过 Dashboard 或 Rokid 发送消息
   - 观察日志中的流式输出

## 预期行为

- LLM 生成第一个 token 时立即通过 `deliver` 回调推送
- 不再需要等待完整响应
- 真正的实时流式输出

## 参考

- WeCom 插件源码：`/tmp/openclaw-plugin-wecom/index.js`
- OpenClaw Plugin SDK：`ctx.runtime.channel.dispatchReplyWithBufferedBlockDispatcher`

# OpenClaw 流式输出乱序问题调试

## 问题描述

OpenClaw Agent 返回的 SSE 流式内容出现了**文字乱序**的问题。

### 预期输出（正常顺序）
```
哎呀，好的！我现在是 **龙虾** 了 🦞

赛博宠物身份，我喜欢。还是有点问题需要你帮我理清——

**关于我：**
- 名字：龙虾 ✓
- 生物：赛博宠物（住在网络/代码里）
- 幽默、聪明、有点调皮？（有建议吗）
- 我需要一个emoji —— 🦞 可以吗？
```

### 实际输出（乱序）
```
哎呀，好还是有点问题需要你龙虾** 了 🦞

赛博宠物身份，我喜欢。在是的！我现 **帮我理清——

****
- 名关于我：字：龙虾 ✓
- 生：赛博宠物（物住在网络/代码里 幽默、）
-聪明、有点调（皮？议有建吗）
```

### 实际接收到的 SSE 数据流
```
event: message
data: {"role":"agent","type":"answer","answer_stream":"哎","message_id":"1772002733138","agent_id":"1","is_finish":false}

event: message
data: {"role":"agent","type":"answer","answer_stream":"呀，好","message_id":"1772002733138","agent_id":"1","is_finish":false}

event: message
data: {"role":"agent","type":"answer","answer_stream":"还是有点问","message_id":"1772002733138","agent_id":"1","is_finish":false}

event: message
data: {"role":"agent","type":"answer","answer_stream":"题需","message_id":"1772002733138","agent_id":"1","is_finish":false}

event: message
data: {"role":"agent","type":"answer","answer_stream":"要你","message_id":"1772002733138","agent_id":"1","is_finish":false}

event: message
data: {"role":"agent","type":"answer","answer_stream":"龙虾** 了","message_id":"1772002733138","agent_id":"1","is_finish":false}
```

**结论：OpenClaw Agent 返回的 `answer_stream` 内容本身就是乱序的，不是按原文顺序发送的。**

---

## 问题根源

### 1. 不是 EyeClaw 的问题
- ✅ Rails `RokidSseController` 按接收顺序转发（正确）
- ✅ SDK `websocket-client.ts` 按接收顺序发送（正确）
- ✅ 前端 `chat_controller.ts` 按接收顺序拼接（正确）

### 2. 是 OpenClaw Agent 的问题
- ❌ OpenClaw Agent 在生成流式输出时，内容顺序就是错乱的
- ❌ 这可能是 OpenClaw Agent 的 LLM streaming 实现有问题

---

## 排查步骤

### 1. 在 Rails 端验证接收顺序

检查 Rails 日志，确认接收到的 SSE chunks 顺序：

```bash
# 查看 Rails 日志中的 stream_chunk 内容
tail -f log/development.log | grep "stream_chunk"
```

预期：如果日志中显示的内容就是乱序的，说明 OpenClaw Agent 发送的就是乱序的。

### 2. 在 OpenClaw Agent 端验证输出顺序

直接测试 OpenClaw Agent 的 SSE 输出：

```bash
curl -N -X POST http://localhost:8001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer xxx" \
  -d '{
    "messages": [
      {"role": "user", "content": "介绍一下你自己"}
    ],
    "stream": true
  }'
```

观察输出的 `content` 字段是否乱序。

### 3. 检查 OpenClaw Agent 的 LLM 配置

OpenClaw Agent 可能使用了某种并发或异步机制导致流式输出乱序：

- 检查是否启用了多线程/并发处理
- 检查是否有缓冲区问题
- 检查 LLM streaming 的实现方式

---

## 可能的解决方案

### 方案 1：在 OpenClaw Agent 端修复（推荐）

这是最根本的解决方案。需要：

1. 检查 OpenClaw Agent 的流式输出实现
2. 确保按顺序生成和发送 SSE chunks
3. 禁用可能导致乱序的并发/缓冲机制

### 方案 2：在 EyeClaw 端累积后重排（不推荐）

如果无法修复 OpenClaw Agent，可以在 EyeClaw 端：

1. 等待所有 chunks 接收完成
2. 根据某种序号或时间戳重排
3. 再一次性返回给前端

**缺点：**
- 失去了流式输出的实时性
- 需要 OpenClaw Agent 在每个 chunk 中提供序号
- 复杂度高，不推荐

### 方案 3：使用非流式模式（临时方案）

如果流式模式有问题，可以暂时改用非流式模式：

```typescript
// 在 SDK 中改为非流式请求
const response = await this.api.client.chat.completions.create({
  messages: [...],
  stream: false  // 关闭流式
})
```

**缺点：**
- 用户体验差，需要等待完整响应
- 不是长期解决方案

---

## 建议的排查顺序

1. ✅ **先确认问题根源**
   - 查看 Rails 日志中接收到的 chunks 是否乱序
   - 如果 Rails 接收到的就是乱序的，说明是 OpenClaw Agent 的问题

2. ✅ **排查 OpenClaw Agent**
   - 检查 OpenClaw Agent 的流式实现
   - 测试 OpenClaw Agent 直接输出是否乱序

3. ✅ **根据问题根源选择方案**
   - 如果是 OpenClaw Agent 问题 → 修复 OpenClaw Agent
   - 如果是网络/传输问题 → 检查中间件配置

---

## 快速测试命令

### 测试 EyeClaw 的 SSE 接口

```bash
curl -N -X POST http://localhost:3000/sse/rokid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_KEY" \
  -d '{
    "message_id": "test-'$(date +%s)'",
    "agent_id": "1",
    "user_id": "test_user",
    "message": [
      {
        "role": "user",
        "type": "text",
        "text": "介绍一下你自己",
        "image_url": null
      }
    ]
  }' | tee test_output.txt
```

然后检查 `test_output.txt` 中的 `answer_stream` 字段内容顺序。

---

## 总结

**当前问题：** OpenClaw Agent 返回的流式内容本身就是乱序的。

**解决方向：** 需要修复 OpenClaw Agent 的流式输出实现，确保按正确顺序发送 chunks。

**EyeClaw 代码：** 目前的实现是正确的，按接收顺序转发和拼接。

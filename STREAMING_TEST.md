# 流式输出测试指南

## 功能说明

已成功实现聊天消息的流式输出功能，用户在Web界面发送消息后，Bot的回复将逐字符实时显示，而不是等待完整响应后一次性显示。

## 实现细节

### 1. SDK 端（`sdk/src/channel.ts`）
- 使用 `spawn` 代替 `exec` 来调用 OpenClaw Agent
- 监听 `stdout` 数据流，实时捕获输出
- 通过 `stream_chunk` 事件将输出分块发送到前端
- 支持以下流式事件：
  - `stream_start`: 开始流式输出
  - `stream_chunk`: 发送文本块
  - `stream_end`: 完成流式输出
  - `stream_error`: 流式输出错误

### 2. SDK Client（`sdk/src/client.ts`）
- 添加 `sendStreamChunk()` 方法用于发送流式消息块
- 在 `handleChannelMessage()` 中处理 `stream_chunk` 类型的消息

### 3. 前端（`app/javascript/controllers/chat_controller.ts`）
- 添加流式消息状态管理：`streamingMessages` Map
- 实现流式消息处理方法：
  - `startStreamingMessage()`: 创建新的流式消息容器
  - `appendStreamingChunk()`: 追加文本块到现有消息
  - `finishStreamingMessage()`: 完成流式消息并清理状态
  - `handleStreamError()`: 处理流式错误
- 添加 `handleStreamChunk()` 自动路由处理器

## 测试方法

### 前提条件

1. **确保 Bot 已创建并获取 SDK Token**
   ```bash
   rails dev:token[your_bot_email]
   ```

2. **配置 OpenClaw Plugin**
   - 将项目中的 SDK 安装为 OpenClaw plugin
   - 配置 botId 和 sdkToken

### 测试步骤

1. **启动 Rails 应用**
   ```bash
   bin/dev
   ```

2. **启动 OpenClaw Gateway（在另一个终端）**
   ```bash
   openclaw gateway
   ```
   这将启动 EyeClaw plugin，连接到 Web 平台

3. **访问聊天界面**
   - 登录 Web 应用
   - 进入 Bots 列表：`http://localhost:3000/bots`
   - 选择你的 Bot，点击 "Chat" 按钮
   - 或直接访问：`http://localhost:3000/bots/[BOT_ID]/chat`

4. **测试流式输出**
   - 在聊天输入框输入消息，例如："你好"
   - 点击 "Send" 按钮
   - 观察机器人的回复是否逐字符实时显示，而不是等待完整响应

### 预期行为

✅ **成功的流式输出**：
- 用户发送消息后立即看到消息在界面上显示
- Bot 的回复开始时会显示一个脉冲动画指示器
- 回复内容逐渐累积显示，可以看到文字逐步出现
- 回复完成后脉冲指示器消失

❌ **非流式输出（修复前）**：
- 用户发送消息后需要等待较长时间
- Bot 的回复一次性完整显示
- 用户体验较差，特别是长回复时

## 调试技巧

1. **查看浏览器控制台**
   ```javascript
   // 应该看到类似的日志：
   Stream event: stream_start, ID: 1708675200000, chunk length: 0
   Stream event: stream_chunk, ID: 1708675200000, chunk length: 50
   Stream event: stream_chunk, ID: 1708675200000, chunk length: 48
   Stream event: stream_end, ID: 1708675200000, chunk length: 0
   ```

2. **查看 OpenClaw Gateway 日志**
   - 应该看到 Agent 的实时输出
   - 确认 spawn 进程正常启动

3. **检查 WebSocket 连接**
   - 浏览器开发者工具 → Network → WS
   - 查看 WebSocket 消息，确认 `stream_chunk` 事件正常传输

## 技术架构

```
User (Web UI) 
    ↓ WebSocket (DashboardChannel)
Rails Server
    ↓ WebSocket (BotChannel)
SDK Client (OpenClaw Plugin)
    ↓ spawn + stdout stream
OpenClaw Agent
    ↓ AI Response (streaming)
LLM API
```

## 注意事项

1. 流式输出依赖 OpenClaw Agent 的流式响应能力
2. 如果 Agent 不支持流式输出，会退化为批量发送
3. 网络延迟可能影响流式体验
4. 建议使用支持流式输出的 LLM 模型（如 GPT-4, Claude 等）

## 故障排查

### 问题：看不到流式效果
**可能原因：**
- OpenClaw Gateway 未启动或未连接
- Bot 状态显示为 offline
- WebSocket 连接断开

**解决方案：**
- 检查 Bot 状态指示器（应该是绿色在线状态）
- 刷新页面重新建立 WebSocket 连接
- 重启 OpenClaw Gateway

### 问题：消息发送后无响应
**可能原因：**
- OpenClaw Agent 未配置或启动失败
- SDK Token 无效

**解决方案：**
- 检查 OpenClaw Gateway 日志
- 验证 SDK Token 是否正确
- 确认 Agent 配置正确

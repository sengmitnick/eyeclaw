# Rokid SSE Cloudflare Worker 实现

## 架构说明

### 问题背景
Rails 7.2 + ActionController::Live + Puma 组合存在内在的缓冲问题，无法实现真正的实时流式输出。即使使用单worker模式、调用`response.commit!()`、设置各种headers，chunks仍然会被缓冲后批量发送。

### 解决方案
使用Cloudflare Workers作为SSE代理层，绕过Rails的缓冲问题：

```
Rokid客户端
  ↓ (SSE请求)
Cloudflare Worker (真正的实时SSE - ReadableStream)
  ↓ (WebSocket)
Rails ActionCable (RokidStreamChannel)
  ↓ (订阅广播)
BotChannel
  ↓ (接收OpenClaw chunks)
OpenClaw SDK
```

### 组件说明

#### 1. RokidStreamChannel (Rails)
- 路径: `app/channels/rokid_stream_channel.rb`
- 功能: 专门为Worker提供的WebSocket订阅频道
- 订阅参数: `access_key`, `bot_id`, `session_id`
- 转发事件: `stream_chunk`, `stream_end`, `stream_error`

#### 2. API::RokidController (Rails)
- 路径: `app/controllers/api/rokid_controller.rb`
- Endpoints:
  - `POST /api/rokid/trigger` - 触发OpenClaw处理
  - `GET /api/rokid/poll` - 长轮询fallback（目前未使用）

#### 3. Cloudflare Worker
- 路径: `cloudflare-worker/rokid-sse-worker.js`
- 功能:
  1. 接收Rokid客户端的POST /sse/rokid请求
  2. 调用Rails `/api/rokid/trigger`触发OpenClaw
  3. 通过WebSocket连接ActionCable订阅chunks
  4. 使用ReadableStream实时转发SSE事件给客户端

### 部署步骤

#### Rails端（已完成）
1. ✅ 创建RokidStreamChannel
2. ✅ 创建API::RokidController
3. ✅ 添加routes配置
4. ✅ 确认ActionCable正常运行

#### Worker端（需要部署）
1. 安装wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

2. 登录Cloudflare:
   ```bash
   wrangler login
   ```

3. 修改`wrangler.toml`配置:
   ```toml
   [vars]
   RAILS_WS_URL = "wss://your-app.com/cable"
   RAILS_HTTP_URL = "https://your-app.com"
   ```

4. 部署Worker:
   ```bash
   cd cloudflare-worker
   wrangler deploy
   ```

5. 获取Worker URL（例如: `https://rokid-sse-worker.yourname.workers.dev`）

#### Rokid平台配置
将Rokid智能体的SSE endpoint URL修改为Worker地址：
```
https://rokid-sse-worker.yourname.workers.dev/sse/rokid
```

### 测试方法

#### 测试Rails API
```bash
# 获取access_key
ACCESS_KEY="your_access_key"

# 测试trigger endpoint
curl -X POST http://localhost:3000/api/rokid/trigger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_KEY" \
  -d '{
    "message_id": "test123",
    "agent_id": "1",
    "message": [{"role":"user","content":"你好"}]
  }'
```

#### 测试Worker（部署后）
```bash
curl -N -X POST https://rokid-sse-worker.yourname.workers.dev/sse/rokid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_KEY" \
  -d '{
    "message_id": "test456",
    "agent_id": "1",
    "message": [{"role":"user","content":"测试流式输出"}]
  }'
```

应该看到实时的SSE输出（每个chunk立即到达，不会批量发送）。

### 为什么这个方案有效

1. **Cloudflare Workers的ReadableStream是真正的流式**
   - 没有Rails的ActionController::Live::Buffer缓冲
   - 直接控制每个chunk的发送时机

2. **ActionCable WebSocket是实时的**
   - BotChannel的广播是实时的（已验证）
   - WebSocket没有HTTP响应缓冲问题

3. **分离关注点**
   - Rails负责业务逻辑和WebSocket广播
   - Worker负责SSE协议和实时传输
   - 各自做自己擅长的事

### 监控和调试

#### Worker日志
```bash
wrangler tail
```

#### Rails日志
```bash
# 查看ActionCable连接
grep "RokidStreamChannel" log/development.log

# 查看BotChannel广播
grep "stream_chunk" log/development.log
```

### 注意事项

1. **WebSocket连接超时**: Cloudflare Workers的WebSocket连接有时间限制（免费版30秒），如果对话很长可能需要重新连接
2. **错误处理**: Worker会捕获WebSocket错误并通过SSE error事件通知客户端
3. **Access Key验证**: 在RokidStreamChannel和API controller都进行了验证，确保安全性
4. **成本**: Cloudflare Workers免费额度：100,000请求/天，足够测试和小规模使用

### 下一步

1. **部署Worker到Cloudflare**
2. **配置Rokid平台使用Worker URL**
3. **进行端到端测试**
4. **监控生产环境表现**

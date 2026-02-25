# 测试指南

## Rails端测试（已完成）

### 测试/api/rokid/trigger endpoint

```bash
# 获取access_key
ACCESS_KEY="ak_db85551fafbd9cd80d129d36a2155623ad20e843c9455fc264ce3ceaf27f5db1"

# 测试trigger endpoint
curl -m 5 -X POST http://localhost:3000/api/rokid/trigger \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_KEY" \
  -d '{
    "message_id": "test123",
    "agent_id": "4",
    "message": [{"role":"user","content":"你好"}],
    "bot_id": 4
  }'
```

**期望响应**:
```json
{
  "bot_id": 4,
  "session_id": "test123",
  "status": "triggered"
}
```

**Rails日志应该显示**:
```
[ActionCable] Broadcasting to bot_4: {...}
[RokidAPI] Triggered OpenClaw processing for bot_id=4, session_id=test123
Completed 200 OK
```

### 测试RokidStreamChannel（WebSocket）

RokidStreamChannel需要通过WebSocket客户端测试。可以使用以下工具：
- Cloudflare Worker（最终方案）
- `wscat`命令行工具
- Browser开发者工具

示例（使用wscat）:
```bash
# 安装wscat
npm install -g wscat

# 连接到ActionCable
wscat -c 'ws://localhost:3000/cable'

# 发送订阅命令
{"command":"subscribe","identifier":"{\"channel\":\"RokidStreamChannel\",\"access_key\":\"ak_db85551fafbd9cd80d129d36a2155623ad20e843c9455fc264ce3ceaf27f5db1\",\"bot_id\":4,\"session_id\":\"test123\"}"}

# 触发消息（在另一个终端）
curl -X POST http://localhost:3000/api/rokid/trigger -H 'Content-Type: application/json' -H 'Authorization: Bearer ak_db85551fafbd9cd80d129d36a2155623ad20e843c9455fc264ce3ceaf27f5db1' -d '{"message_id":"test123","agent_id":"4","message":[{"role":"user","content":"你好"}],"bot_id":4}'

# wscat应该实时接收到stream_chunk消息
```

## Worker端测试（待部署后测试）

### 本地测试Worker（使用wrangler dev）

Cloudflare Workers支持本地开发模式：

```bash
cd cloudflare-worker

# 启动本地开发服务器
wrangler dev

# 在另一个终端测试
curl -N -X POST http://localhost:8787/sse/rokid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_KEY" \
  -d '{
    "message_id": "local_test_001",
    "agent_id": "4",
    "message": [{"role":"user","content":"测试Worker本地开发"}],
    "bot_id": 4
  }'
```

**注意**: `wrangler dev`模式下，Worker会连接到你的本地Rails（需要修改`RAILS_WS_URL`和`RAILS_HTTP_URL`为localhost）。

### 部署后测试

```bash
# 部署Worker
cd cloudflare-worker
wrangler deploy

# 测试（假设Worker URL是 https://rokid-sse-worker.yourname.workers.dev）
curl -N -X POST https://rokid-sse-worker.yourname.workers.dev/sse/rokid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_KEY" \
  -d '{
    "message_id": "prod_test_001",
    "agent_id": "4",
    "message": [{"role":"user","content":"生产环境测试"}],
    "bot_id": 4
  }'
```

**期望行为**:
1. 立即输出`: connected\n\n`（SSE注释）
2. 实时接收`event: message`事件（每个chunk独立到达，不批量）
3. 最后接收`event: done`表示完成

**对比旧的/sse/rokid endpoint**:
- 旧endpoint: 所有chunks在3-4秒后一次性输出
- 新endpoint: 每个chunk在生成后100ms内到达

## 端到端测试检查清单

- [ ] Rails `/api/rokid/trigger`返回200 OK
- [ ] Rails日志显示`[ActionCable] Broadcasting to bot_X`
- [ ] RokidStreamChannel接受WebSocket连接
- [ ] RokidStreamChannel订阅成功
- [ ] Worker本地开发模式可以连接localhost Rails
- [ ] Worker部署后可以连接生产Rails
- [ ] SSE客户端实时接收chunks（不批量）
- [ ] Rokid平台配置使用Worker URL后正常工作

## 故障排查

### Worker连接不上Rails

**症状**: Worker日志显示`WebSocket connection error`

**检查**:
1. `RAILS_WS_URL`配置正确吗？应该是`wss://yourdomain.com/cable`（生产）或`ws://localhost:3000/cable`（开发）
2. Rails ActionCable是否正常运行？访问`/cable`应该返回Upgrade to WebSocket
3. Cloudflare Worker是否有网络限制？检查防火墙

### 认证失败

**症状**: Worker或Rails返回401 Unauthorized

**检查**:
1. Access Key是否正确？
2. Access Key是否active？`rails runner 'puts AccessKey.first.is_active'`
3. Rails日志中AccessKey查询是否成功？

### chunks仍然批量发送

**症状**: 虽然使用Worker，但chunks还是一次性到达

**检查**:
1. 确认你在测试Worker endpoint（不是原来的`/sse/rokid`）
2. Worker是否真的在使用WebSocket订阅？检查Worker日志
3. BotChannel广播是否正常？检查Rails日志中的`[ActionCable] Broadcasting`

### OpenClaw没有响应

**症状**: trigger成功但没有接收到任何chunks

**检查**:
1. Bot SDK是否已连接？检查Rails日志中`Bot authenticated`
2. Bot ID是否正确？
3. OpenClaw SDK配置是否正确？

## 性能基准

**目标延迟**（从OpenClaw SDK发送chunk到Rokid客户端接收）:
- Worker方案: < 200ms
- 旧方案: 3000-4000ms（批量发送）

**测试方法**:
```bash
# 记录每个chunk的到达时间
curl -N -X POST <endpoint> ... | while IFS= read -r line; do
  echo "[$(date '+%H:%M:%S.%3N')] $line"
done
```

应该看到每行输出时间间隔在100-200ms左右（OpenClaw生成速度），而不是全部集中在同一秒。

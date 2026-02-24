# Rokid Lingzhu SSE API 测试指南

## 测试脚本

### 1. 基础文本消息测试

```bash
curl -N -X POST http://localhost:3000/sse/rokid \
  -H "Authorization: Bearer test_token_123456" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "1021",
    "agent_id": "1",
    "user_id": "test_user_123",
    "metadata": {
      "context": {
        "location": "杭州市西湖区世贸中心",
        "latitude": "39.9088",
        "longitude": "116.3975",
        "currentTime": "2025-03-11 11:22:41",
        "weather": "晴天",
        "battery": "85%"
      }
    },
    "message": [
      {"role": "user", "type": "text", "text": "若琪帮我写一首诗"}
    ]
  }'
```

**预期输出**: 流式输出 "你好！我是小龙虾。我收到了你的消息：「若琪帮我写一首诗」。"

---

### 2. 图片消息测试

```bash
curl -N -X POST http://localhost:3000/sse/rokid \
  -H "Authorization: Bearer test_token" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "1022",
    "agent_id": "1",
    "message": [
      {"role": "user", "type": "image", "text": "https://example.com/image.jpg"}
    ]
  }'
```

**预期输出**: 流式输出 "你好！我是小龙虾。我收到了你的消息：「[图片]」。"

---

### 3. 错误处理测试

#### 3.1 缺少必填参数

```bash
curl -X POST http://localhost:3000/sse/rokid \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "1023"
  }'
```

**预期输出**:
```
event: message
data: {"role":"agent","type":"error","message":"Missing required parameters: message_id, agent_id, or message","is_finish":true}

event: done
data: {"role":"agent","type":"error","message":"Missing required parameters: message_id, agent_id, or message","is_finish":true}
```

#### 3.2 Bot 不存在

```bash
curl -X POST http://localhost:3000/sse/rokid \
  -H "Authorization: Bearer test_token" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "1024",
    "agent_id": "999",
    "message": [
      {"role": "user", "type": "text", "text": "test"}
    ]
  }'
```

**预期输出**:
```
event: message
data: {"role":"agent","type":"error","message":"Bot not found: 999","is_finish":true}

event: done
data: {"role":"agent","type":"error","message":"Bot not found: 999","is_finish":true}
```

#### 3.3 缺少 Authorization

```bash
curl -X POST http://localhost:3000/sse/rokid \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "1025",
    "agent_id": "1",
    "message": [
      {"role": "user", "type": "text", "text": "test"}
    ]
  }'
```

**预期输出**:
```
event: message
data: {"role":"agent","type":"error","message":"Missing or invalid Authorization header","is_finish":true}

event: done
data: {"role":"agent","type":"error","message":"Missing or invalid Authorization header","is_finish":true}
```

---

## 测试结果验证

### ✅ 成功标准

1. **流式输出**: 响应应逐字符返回，每个字符作为一个独立的 SSE 事件
2. **事件格式**: 每个事件包含 `event:` 和 `data:` 两行
3. **数据结构**: JSON 数据包含必填字段：`role`, `type`, `message_id`, `agent_id`, `is_finish`
4. **完成标记**: 最后必须发送 `is_finish: true` 的消息和 `done` 事件

### ❌ 失败情况

1. 缺少必填参数时返回错误事件
2. Bot 不存在时返回错误事件
3. 缺少 Authorization 时返回错误事件
4. JSON 格式错误时返回错误事件

---

## 自动化测试脚本

将以下脚本保存为 `test_rokid_sse.sh`:

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"
SUCCESS_COUNT=0
FAIL_COUNT=0

echo "================================"
echo "Rokid Lingzhu SSE API 测试"
echo "================================"
echo ""

# 测试 1: 基础文本消息
echo "[测试 1] 基础文本消息测试..."
RESPONSE=$(curl -sN -X POST "$BASE_URL/sse/rokid" \
  -H "Authorization: Bearer test_token" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "test_1",
    "agent_id": "1",
    "message": [{"role": "user", "type": "text", "text": "你好"}]
  }' | head -5)

if [[ $RESPONSE == *"event: message"* && $RESPONSE == *"answer_stream"* ]]; then
  echo "✅ 通过"
  ((SUCCESS_COUNT++))
else
  echo "❌ 失败"
  ((FAIL_COUNT++))
fi
echo ""

# 测试 2: 图片消息
echo "[测试 2] 图片消息测试..."
RESPONSE=$(curl -sN -X POST "$BASE_URL/sse/rokid" \
  -H "Authorization: Bearer test_token" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "test_2",
    "agent_id": "1",
    "message": [{"role": "user", "type": "image", "text": "https://example.com/image.jpg"}]
  }' | head -5)

if [[ $RESPONSE == *"event: message"* ]]; then
  echo "✅ 通过"
  ((SUCCESS_COUNT++))
else
  echo "❌ 失败"
  ((FAIL_COUNT++))
fi
echo ""

# 测试 3: 缺少参数错误
echo "[测试 3] 缺少必填参数错误处理..."
RESPONSE=$(curl -s -X POST "$BASE_URL/sse/rokid" \
  -H "Content-Type: application/json" \
  -d '{"message_id": "test_3"}')

if [[ $RESPONSE == *"Missing required parameters"* ]]; then
  echo "✅ 通过"
  ((SUCCESS_COUNT++))
else
  echo "❌ 失败"
  ((FAIL_COUNT++))
fi
echo ""

# 测试 4: Bot 不存在错误
echo "[测试 4] Bot 不存在错误处理..."
RESPONSE=$(curl -s -X POST "$BASE_URL/sse/rokid" \
  -H "Authorization: Bearer test_token" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "test_4",
    "agent_id": "999999",
    "message": [{"role": "user", "type": "text", "text": "test"}]
  }')

if [[ $RESPONSE == *"Bot not found"* ]]; then
  echo "✅ 通过"
  ((SUCCESS_COUNT++))
else
  echo "❌ 失败"
  ((FAIL_COUNT++))
fi
echo ""

# 测试 5: 缺少 Authorization 错误
echo "[测试 5] 缺少 Authorization 错误处理..."
RESPONSE=$(curl -s -X POST "$BASE_URL/sse/rokid" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "test_5",
    "agent_id": "1",
    "message": [{"role": "user", "type": "text", "text": "test"}]
  }')

if [[ $RESPONSE == *"Authorization"* ]]; then
  echo "✅ 通过"
  ((SUCCESS_COUNT++))
else
  echo "❌ 失败"
  ((FAIL_COUNT++))
fi
echo ""

# 总结
echo "================================"
echo "测试完成"
echo "================================"
echo "成功: $SUCCESS_COUNT"
echo "失败: $FAIL_COUNT"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
  echo "🎉 所有测试通过！"
  exit 0
else
  echo "⚠️  部分测试失败，请检查"
  exit 1
fi
```

运行测试：
```bash
chmod +x test_rokid_sse.sh
./test_rokid_sse.sh
```

---

## 生产环境测试

将 `localhost:3000` 替换为实际域名：

```bash
curl -N -X POST https://your-domain.com/sse/rokid \
  -H "Authorization: Bearer your_production_ak" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "prod_test_1",
    "agent_id": "YOUR_BOT_ID",
    "user_id": "test_user",
    "message": [
      {"role": "user", "type": "text", "text": "测试消息"}
    ]
  }'
```

---

## 常见问题排查

### 问题 1: 没有流式输出

**症状**: 响应一次性返回，没有逐字符输出

**原因**: 可能是 nginx 或代理服务器缓冲了响应

**解决方案**: 在 nginx 配置中添加：
```nginx
proxy_buffering off;
proxy_cache off;
proxy_set_header Connection '';
proxy_http_version 1.1;
chunked_transfer_encoding off;
```

### 问题 2: Authorization 验证失败

**症状**: 总是返回 "Invalid authentication token"

**原因**: Bot 配置了 `rokid_device_id` 但传入的 AK 不匹配

**解决方案**: 
1. 检查 Bot 的 `rokid_device_id` 字段
2. 确保 Authorization header 中的 token 与之匹配
3. 或清空 Bot 的 `rokid_device_id` 字段以禁用验证

### 问题 3: 连接超时

**症状**: SSE 连接很快断开

**原因**: 
1. nginx timeout 设置过短
2. 客户端 timeout 设置过短

**解决方案**:
```nginx
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

---

## 性能建议

1. **使用生产环境配置**: 确保 Puma 使用多 worker 模式
2. **添加监控**: 监控 SSE 连接数和响应时间
3. **优化数据库查询**: Bot 查询可以添加缓存
4. **限流**: 考虑添加请求频率限制

---

## 相关文档

- [灵珠平台 SSE API 文档](./ROKID_LINGZHU_SSE_API.md)
- [原 MCP API 文档](./ROKID_MCP_API.md) (已弃用)
- [项目部署文档](./project.md)

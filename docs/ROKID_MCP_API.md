# Rokid MCP API 文档

## 概述

乐奇灵珠（Rokid Lingzhu）MCP 集成采用 **SSE (Server-Sent Events) + JSON-RPC 2.0** 协议实现。

## 协议流程

```
1. 客户端发起 SSE 连接
   GET /mcp/rokid/sse
   
2. 服务端返回 session_id
   data: {"endpoint": "/messages/?session_id=xxx"}
   
3. 客户端发送 JSON-RPC 请求
   POST /messages/?session_id=xxx
   Body: {"jsonrpc": "2.0", "method": "tools/list", ...}
   
4. 服务端通过 SSE 推送响应
   data: {"jsonrpc": "2.0", "id": 123, "result": {...}}
```

## API 端点

### 1. 建立 SSE 连接

```bash
GET /mcp/rokid/sse
```

**响应格式 (SSE Stream):**

```
data: {"endpoint": "/messages/?session_id=90f4634d4316429f94595c53fa036e22"}

data: {"type": "ping"}

... (保持连接)
```

### 2. 发送 JSON-RPC 2.0 请求

```bash
POST /messages/?session_id=<session_id>
Content-Type: application/json
```

## 可用工具 (Tools)

### tools/list - 获取工具列表

**请求示例:**

```bash
curl -X POST "http://localhost:3000/messages/?session_id=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

**响应 (通过 SSE 推送):**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "send_message",
        "description": "Send a message to the bot and get response",
        "inputSchema": {
          "type": "object",
          "properties": {
            "botId": {
              "type": "string",
              "description": "Bot ID (required)"
            },
            "message": {
              "type": "string",
              "description": "Message content to send to the bot"
            },
            "deviceId": {
              "type": "string",
              "description": "Device ID for authentication (optional)"
            }
          },
          "required": ["botId", "message"]
        }
      },
      {
        "name": "get_bot_info",
        "description": "Get bot information and status",
        "inputSchema": {
          "type": "object",
          "properties": {
            "botId": {
              "type": "string",
              "description": "Bot ID (required)"
            }
          },
          "required": ["botId"]
        }
      }
    ]
  }
}
```

### tools/call - 调用工具

#### 发送消息 (send_message)

**请求示例:**

```bash
curl -X POST "http://localhost:3000/messages/?session_id=xxx" \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: AR-G1-123456" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "send_message",
      "arguments": {
        "botId": "1",
        "message": "你好，乐奇眼镜！",
        "deviceId": "AR-G1-123456"
      }
    }
  }'
```

**响应 (通过 SSE 推送):**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "status": "sent",
    "bot_id": 1,
    "bot_name": "小龙虾",
    "message": "你好，乐奇眼镜！",
    "timestamp": "2026-02-23T15:30:00Z"
  }
}
```

#### 获取Bot信息 (get_bot_info)

**请求示例:**

```bash
curl -X POST "http://localhost:3000/messages/?session_id=xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "get_bot_info",
      "arguments": {
        "botId": "1"
      }
    }
  }'
```

**响应 (通过 SSE 推送):**

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "id": 1,
    "name": "小龙虾",
    "description": "一个智能助手",
    "status": "active",
    "online": true,
    "active_sessions": 2,
    "last_seen": "2026-02-23T15:30:00Z"
  }
}
```

## Bot 关联机制

### 方案：在工具调用时传入 botId

每次调用工具时，必须在 `arguments` 中传入 `botId` 参数：

```json
{
  "arguments": {
    "botId": "123",         // 必需
    "message": "你好",
    "deviceId": "AR-G1-xxx"  // 可选
  }
}
```

### 设备 ID 验证

支持两种方式传递设备 ID（可选）：

1. **通过 arguments 传递** (推荐):
   ```json
   {
     "arguments": {
       "botId": "1",
       "deviceId": "AR-G1-123456",
       "message": "你好"
     }
   }
   ```

2. **通过 HTTP Header 传递**:
   ```bash
   curl -H "X-Device-Id: AR-G1-123456" ...
   ```

优先级：`arguments.deviceId` > `X-Device-Id header`

如果 Bot 配置了 `rokid_device_id` 字段，则会验证传入的 `deviceId` 是否匹配。

## 错误处理

### JSON-RPC 2.0 错误格式

```json
{
  "jsonrpc": "2.0",
  "id": null,
  "error": {
    "code": -32600,
    "message": "Invalid session_id"
  }
}
```

### 错误代码

| Code | Message | 描述 |
|------|---------|------|
| -32700 | Parse error | JSON 解析失败 |
| -32600 | Invalid Request | 无效的 session_id 或请求格式 |
| -32601 | Method not found | 方法不存在或工具不存在 |
| -32602 | Invalid params | 缺少必需参数（如 botId, message） |
| -32603 | Internal error | 设备未授权或其他内部错误 |

## 完整测试流程

### 步骤 1: 建立 SSE 连接

```bash
# 在终端 1 中运行（保持连接）
curl -N -X GET http://localhost:3000/mcp/rokid/sse
```

**输出示例:**
```
data: {"endpoint":"/messages/?session_id=90f4634d4316429f94595c53fa036e22"}

data: {"type":"ping"}
```

记录返回的 `session_id`。

### 步骤 2: 获取工具列表

```bash
# 在终端 2 中运行
curl -X POST "http://localhost:3000/messages/?session_id=90f4634d4316429f94595c53fa036e22" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

### 步骤 3: 调用工具

```bash
curl -X POST "http://localhost:3000/messages/?session_id=90f4634d4316429f94595c53fa036e22" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "send_message",
      "arguments": {
        "botId": "1",
        "message": "测试消息"
      }
    }
  }'
```

### 步骤 4: 在终端 1 查看 SSE 响应

终端 1 应该显示:
```
data: {"jsonrpc":"2.0","id":2,"result":{"status":"sent","bot_id":1,"bot_name":"小龙虾","message":"测试消息","timestamp":"2026-02-23T15:30:00Z"}}
```

## 技术实现细节

### Session 管理

- 当前使用类变量 `@@sessions` 和 `@@session_streams` 存储
- **生产环境建议**: 使用 Redis 存储 session 状态
- Session 超时: 30分钟无活动自动清理

### SSE 连接保持

- 每 5 秒发送一次心跳 ping
- 检测客户端断开（IOError, Errno::EPIPE）
- 自动清理断开的连接

### 并发处理

- 每个 SSE 连接运行在独立的请求线程中
- JSON-RPC 请求通过 session_id 查找对应的 SSE 流
- 响应通过 SSE 推送到客户端

## 安全性考虑

1. **设备绑定**: Bot 可配置 `rokid_device_id`，只允许特定设备访问
2. **参数验证**: 严格验证 botId、message 等必需参数
3. **Session 隔离**: 每个 session 独立管理，互不干扰
4. **超时清理**: 自动清理超时的 session，防止资源泄漏

## Bot 配置示例

在 Bot 详情页面（`/bots/:id`）会显示：

```
Rokid Lingzhu Integration

MCP Endpoint: POST https://your-domain.com/mcp/rokid

Required parameters:
• bot_id: 123
• device_id: AR-G1-XXX (if configured)
```

## 参考资料

- [乐奇 MCP 官方文档](https://rokid.yuque.com/ub8h5n/hth52o/akz32hafhl6kaedr)
- JSON-RPC 2.0 规范: https://www.jsonrpc.org/specification
- SSE 标准: https://html.spec.whatwg.org/multipage/server-sent-events.html

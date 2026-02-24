# Rokid MCP Integration Guide

## 概述

EyeClaw 已与乐奇灵珠平台（Rokid Lingzhu）集成，通过固定的 MCP (Model Context Protocol) 端点提供 AR 眼镜智能助手服务。

## 架构设计

### 变更说明
- **移除字段**：`mcp_url` （原每个 Bot 独立 URL）
- **新增字段**：`rokid_device_id` （可选，用于绑定特定眼镜设备）
- **固定端点**：`POST /mcp/rokid` （所有 Bot 共享）

### 工作原理
```
乐奇眼镜 → POST /mcp/rokid + bot_id → EyeClaw Bot → 响应
```

## API 接口

### 端点
```
POST /mcp/rokid
```

### 请求参数

#### 方式 1: JSON Body（推荐）
```json
{
  "bot_id": 4,
  "device_id": "AR-G1-123456",  // 可选
  "type": "ping",
  "command": "execute_something",
  "params": {}
}
```

#### 方式 2: HTTP Header
```http
POST /mcp/rokid
Content-Type: application/json
X-Device-Id: AR-G1-123456

{
  "bot_id": 4,
  "type": "status"
}
```

### 响应格式

#### 成功：SSE Stream
```
Content-Type: text/event-stream

event: message
data: {"type":"connected","bot_id":4,"name":"小龙虾二号"}

event: message
data: {"type":"pong","timestamp":"2026-02-23T15:30:00Z"}
```

#### 失败：JSON Error
```json
{
  "error": "Bot not found",
  "message": "请提供有效的 bot_id 参数"
}
```

```json
{
  "error": "Device unauthorized",
  "message": "设备 ID 不匹配"
}
```

## 安全机制

### 1. Bot ID 验证
- 必须提供有效的 `bot_id`
- 系统验证 Bot 是否存在

### 2. 设备绑定（可选）
- 如果 Bot 配置了 `rokid_device_id`，则必须提供匹配的 `device_id`
- 支持请求头 `X-Device-Id` 或 JSON Body 中的 `device_id` 字段
- 未配置设备 ID 的 Bot 不强制校验

## 在 Bot 页面配置

### 创建/编辑 Bot
1. 访问 `/bots/new` 或 `/bots/:id/edit`
2. 可选填写 **Rokid Device ID**（例如：`AR-G1-123456`）
3. 保存后，系统会：
   - 仅允许指定设备访问（如果配置了设备 ID）
   - 显示 Rokid 集成端点和参数说明

### Bot 详情页
访问 `/bots/:id` 查看：
- **Rokid MCP Endpoint**：`POST /mcp/rokid`
- **Required Parameters**：
  - `bot_id`: Bot 的 ID
  - `device_id`: 设备 ID（如果配置了）

## 使用示例

### cURL 测试
```bash
# 基础请求
curl -X POST http://your-domain.com/mcp/rokid \
  -H "Content-Type: application/json" \
  -d '{"bot_id": 4, "type": "ping"}'

# 带设备 ID
curl -X POST http://your-domain.com/mcp/rokid \
  -H "Content-Type: application/json" \
  -H "X-Device-Id: AR-G1-123456" \
  -d '{"bot_id": 4, "type": "status"}'
```

### JavaScript SDK
```javascript
const eventSource = new EventSource('/mcp/rokid?bot_id=4');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
  
  switch (data.type) {
    case 'connected':
      console.log('Connected to bot:', data.bot_id);
      break;
    case 'pong':
      console.log('Ping response:', data.timestamp);
      break;
    case 'result':
      console.log('Command result:', data.data);
      break;
  }
};

eventSource.onerror = (error) => {
  console.error('Connection error:', error);
};
```

## 消息类型

### 请求类型（type 字段）
- `ping`: 心跳检测
- `execute`: 执行命令
- `status`: 查询 Bot 状态

### 响应类型
- `connected`: 连接成功
- `pong`: 心跳响应
- `result`: 命令执行结果
- `status`: Bot 状态信息
- `error`: 错误信息

## 故障排查

### 错误 1：Bot not found
**原因**：提供的 bot_id 不存在
**解决**：检查 bot_id 是否正确，确认 Bot 已创建

### 错误 2：Device unauthorized
**原因**：提供的 device_id 与 Bot 配置的不匹配
**解决**：
1. 检查设备 ID 是否正确
2. 或在 Bot 设置中移除设备绑定

### 错误 3：连接超时
**原因**：Bot 离线或网络问题
**解决**：
1. 检查 Bot 是否在线（查看 `/bots/:id`）
2. 确认网络连接正常
3. 查看服务器日志

## 开发建议

1. **先测试不绑定设备**：创建 Bot 时不填写 `rokid_device_id`，方便测试
2. **使用固定 bot_id**：避免频繁更改，便于设备端配置
3. **实现心跳机制**：定期发送 `ping` 消息保持连接
4. **处理断线重连**：SSE 连接可能断开，需要自动重连逻辑

## 与原 MCP 的区别

| 特性 | 原 MCP 系统 | Rokid MCP 集成 |
|------|-------------|----------------|
| URL | `/mcp/:bot_id/metadata` | `/mcp/rokid` (固定) |
| Bot 识别 | URL 中的 bot_id | 请求参数中的 bot_id |
| 设备绑定 | 无 | 支持 rokid_device_id |
| 通用性 | 通用 MCP 协议 | 乐奇灵珠专用 |
| URL 字段 | 每个 Bot 独立 | 全局统一 |

## 相关文件

- **Model**: `app/models/bot.rb`
- **Controller**: `app/controllers/mcp_controller.rb`
- **Routes**: `config/routes.rb` → `post 'mcp/rokid'`
- **Migration**: `db/migrate/20260223152707_update_bots_for_rokid_integration.rb`
- **Views**: 
  - `app/views/bots/show.html.erb`
  - `app/views/bots/new.html.erb`
  - `app/views/bots/edit.html.erb`

## 支持

如有问题，请联系：support@eyeclaw.com

# Rokid Lingzhu Platform SSE API 文档

## 概述

本文档介绍 EyeClaw 与乐奇灵珠平台集成的自定义智能体 SSE 接口。该接口符合灵珠平台的三方智能体导入协议。

## 接口端点

```
POST /sse/rokid
```

## 协议特点

- **传输方式**: Server-Sent Events (SSE)
- **内容格式**: JSON
- **鉴权方式**: Bearer Token
- **流式输出**: 支持逐字符流式返回

## 请求格式

### Headers

| Header | 类型 | 必填 | 说明 |
|--------|------|------|------|
| Authorization | String | 是 | Bearer $智能体鉴权AK |
| Content-Type | String | 是 | application/json |

### Body 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message_id | String | 是 | 消息ID，用于维持上下文 |
| agent_id | String | 是 | 智能体ID（对应 Bot ID） |
| user_id | String | 否 | 用户ID |
| message | Message[] | 是 | 用户输入消息数组 |
| metadata | Metadata | 否 | 可选元数据（设备信息等） |

#### Message Object

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| role | String | 是 | 角色：user/agent |
| type | String | 是 | 消息类型：text/image |
| text | String | 否 | 消息内容：type为text时不可为空 |
| image_url | String | 否 | 图片内容：type为image时不可为空 |

#### Metadata Object

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| context | Context | 是 | 灵珠平台传入的设备信息 |

#### Context Object

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| location | String | 是 | 设备当前所在位置信息 |
| latitude | String | 是 | 设备当前所在纬度 |
| longitude | String | 是 | 设备当前所在经度 |
| weather | String | 是 | 设备当前所在地天气信息 |
| battery | String | 是 | 设备当前电量 |

### 请求示例

```bash
curl -N -X POST http://your-domain.com/sse/rokid \
  -H "Authorization: Bearer your_ak_token" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "1021",
    "agent_id": "1",
    "user_id": "user_123",
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

## 响应格式

### SSE Event Types

| Event | 说明 |
|-------|------|
| message | 内容输出 |
| done | 结束 |

### Data 字段

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| role | String | 是 | agent |
| message_id | String | 是 | 消息ID，维持上下文 |
| agent_id | String | 是 | 智能体ID |
| type | String | 是 | answer/tool_call/follow_up/error |
| answer_stream | String | 否 | 流式输出内容 |
| is_finish | Boolean | 是 | 是否完成 |
| follow_up | String[] | 否 | 用户问题建议 |
| tool_call | Tool | 否 | 工具调用 |

#### Tool Object

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| command | String | 是 | 命令：take_photo/take_navigation/notify_agent_off/control_calendar |
| action | String | 否 | 动作（根据命令不同） |
| poi_name | String | 否 | 目标地址（导航命令） |
| navi_type | String | 否 | 导航类型：0驾车/1步行/2骑行 |
| title | String | 否 | 日程标题 |
| start_time | String | 否 | 日程开始时间 |
| end_time | String | 否 | 日程结束时间 |

### 响应示例

#### 成功响应（流式输出）

```
event: message
data: {"role":"agent","type":"answer","answer_stream":"你","message_id":"1021","agent_id":"1","is_finish":false}

event: message
data: {"role":"agent","type":"answer","answer_stream":"好","message_id":"1021","agent_id":"1","is_finish":false}

...

event: message
data: {"role":"agent","type":"answer","answer_stream":"","message_id":"1021","agent_id":"1","is_finish":true}

event: done
data: {"role":"agent","type":"answer","message_id":"1021","agent_id":"1","is_finish":true}
```

#### 错误响应

```
event: message
data: {"role":"agent","type":"error","message":"Bot not found: 999","is_finish":true}

event: done
data: {"role":"agent","type":"error","message":"Bot not found: 999","is_finish":true}
```

## 错误处理

| 错误类型 | 说明 |
|---------|------|
| Missing Authorization | 缺少或无效的 Authorization header |
| Missing required parameters | 缺少必填参数（message_id, agent_id, message） |
| Bot not found | 指定的 agent_id 对应的 Bot 不存在 |
| Invalid authentication token | AK 验证失败 |
| Invalid JSON | 请求体 JSON 格式错误 |

## 在灵珠平台配置

### 1. 创建三方智能体

登录灵珠平台 → 项目开发 → 三方智能体 → 创建

### 2. 填写配置信息

| 字段 | 值 |
|------|-----|
| 三方厂商 | 自定义 |
| 三方智能体ID | Bot ID（例如：1） |
| 三方智能体AK | Bot 的鉴权 AK（可使用 rokid_device_id 字段） |
| 智能体SSE接口地址 | https://your-domain.com/sse/rokid |
| 智能体名称 | Bot 名称 |
| 入参类型 | 文字、图片 |

### 3. Bot 配置

在 EyeClaw 系统中配置 Bot：

- **ID**: 作为 agent_id 传递给灵珠平台
- **rokid_device_id**: （可选）作为 AK 验证

## 测试命令

```bash
# 基础测试
curl -N -X POST http://localhost:3000/sse/rokid \
  -H "Authorization: Bearer test_token" \
  -H "Content-Type: application/json" \
  -d '{
    "message_id": "1021",
    "agent_id": "1",
    "message": [
      {"role": "user", "type": "text", "text": "你好"}
    ]
  }'

# 图片消息测试
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

## 与旧版 MCP 协议的区别

| 特性 | 旧版 MCP (/mcp/rokid/sse) | 新版灵珠协议 (/sse/rokid) |
|------|---------------------------|---------------------------|
| 协议类型 | JSON-RPC 2.0 + SSE | 纯 SSE |
| 连接方式 | GET 建立连接 + POST 发送消息 | 直接 POST 发送消息 |
| 响应方式 | 通过 session_id 关联 | 直接流式返回 |
| 适用场景 | MCP 工具调用 | 灵珠平台智能体集成 |
| 状态 | 已弃用但保留兼容 | 推荐使用 |

## 注意事项

1. **Authorization Header**: 必须包含有效的 Bearer Token
2. **agent_id**: 必须是系统中存在的 Bot ID
3. **流式输出**: 响应是逐字符流式输出，需要支持 SSE 的客户端
4. **连接保持**: SSE 连接会保持到消息发送完成
5. **错误处理**: 所有错误都会通过 SSE event 返回

## 相关文件

- **Controller**: `app/controllers/rokid_sse_controller.rb`
- **Routes**: `config/routes.rb` → `post 'sse/rokid'`
- **Model**: `app/models/bot.rb`

## 支持

如有问题，请参考：
- 灵珠平台文档：https://rokid.yuque.com/ub8h5n/hth52o/qq4gs616xz4ellh1
- 项目文档：`docs/project.md`

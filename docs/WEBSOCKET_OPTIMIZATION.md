# WebSocket 连接稳定性优化总结

## 优化概述

本次优化旨在解决线上环境 WebSocket 频繁断开的问题，确保 SDK 与服务器之间的连接更加稳定。

## 主要优化点

### 1. SDK 心跳策略优化 (`sdk/src/websocket-client.ts`)

**问题**: 原心跳间隔 60 秒太长，负载均衡器可能在此期间判定连接超时。

**优化**:
- 心跳间隔从 60 秒缩短到 **30 秒**（比负载均衡器超时时间短）
- 新增 `connectionHealthCheckTimer`：每 10 秒检查一次 WebSocket 状态
- 新增 `checkConnectionHealth()` 方法主动检测连接健康状态

### 2. 重连逻辑优化 (`sdk/src/websocket-client.ts`)

**新增功能**:
- 追踪关闭码 (`lastCloseCode`)：区分正常关闭 (1000/1001) 和异常关闭
- 连续失败计数 (`consecutiveFailures`)：连续失败时增加延迟
- 智能退避策略：
  - 连续失败 > 3 次：延迟增加 1.5x
  - 异常关闭码：延迟增加 1.5x
  - 保留随机抖动 (±25%)

### 3. 连接断开检测增强 (`sdk/src/websocket-client.ts`)

**优化**:
- 更详细的断开日志：显示关闭码和是否干净关闭
- 区分部署重启和首次连接失败
- 更好的状态追踪

### 4. SolidCable 配置优化 (`config/cable.yml`)

```yaml
production:
  adapter: solid_cable
  # 新增配置
  read_timeout: 30.seconds    # 增加到 30 秒，配合负载均衡器
  heartbeat_interval: 15.seconds  # 心跳间隔
```

### 5. Rails 端日志增强

**ApplicationCable::Connection** (`app/channels/application_cable/connection.rb`):
- 新增唯一连接 ID (`connection_id`) 用于追踪
- 记录更多连接信息：Remote IP、User-Agent
- 新增 `disconnect` 方法记录断开

**BotChannel** (`app/channels/bot_channel.rb`):
- 所有日志添加 `connection_id` 前缀
- 记录订阅/取消订阅详细信息
- ping/pong 消息增加调试日志

## WebSocket 关闭码说明

| 关闭码 | 含义 | SDK 行为 |
|--------|------|----------|
| 1000 | 正常关闭 | 视为部署重启，立即重连 |
| 1001 | 离开 | 视为部署重启，立即重连 |
| 1006 | 异常关闭 | 增加重连延迟 |
| 1011 | 服务器错误 | 增加重连延迟 |
| 其他 | 未知 | 增加重连延迟 |

## 生产环境建议

1. **负载均衡器配置**:
   - 健康检查间隔: 10-30 秒
   - 超时: 30-60 秒
   - 不健康阈值: 3 次

2. **监控**:
   - 关注连接断开率
   - 追踪重连次数
   - 监控 Bot 在线状态

3. **部署策略**:
   - 使用 Puma `tmp_restart` 插件实现零断连部署
   - 部署时 SDK 会自动在 100ms-2s 内重连

## 相关文件修改

- `sdk/src/websocket-client.ts` - SDK 端优化
- `app/channels/application_cable/connection.rb` - 连接日志增强
- `app/channels/bot_channel.rb` - Channel 日志增强
- `config/cable.yml` - SolidCable 配置优化

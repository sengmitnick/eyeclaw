# ACK 机制与详细监控验证文档

## 验证目标
1. 验证 ACK 机制是否有效防止尾部 chunks 丢失
2. 验证详细监控能否准确记录丢包信息
3. 验证超时保护机制是否正常工作

## 测试环境
- Rails 服务器运行在本地
- SDK (v2.4.0) 包含 ACK 机制
- StreamTrace 记录详细监控数据

## 验证步骤

### 1. 正常场景（所有 ACK 收到）
**操作**：发送一条消息，触发流式响应

**预期结果**：
- SDK 日志：`✅ All chunks ACKed: X/X in Yms`
- StreamTrace 记录：
  - `sdk_total_chunks` = 实际发送数量
  - `missing_sequences` = []（空数组）
  - `loss_position` = nil
  - `status` = 'completed'

### 2. ACK 延迟场景（模拟网络延迟）
**操作**：在高负载情况下发送消息

**预期结果**：
- SDK 等待时间增加，但最终所有 ACK 收到
- SDK 日志：`✅ All chunks ACKed: X/X in Yms` (Y > 100ms)
- StreamTrace 正常

### 3. ACK 超时场景（2秒超时）
**操作**：人为阻塞 ActionCable 或极高负载

**预期结果**：
- SDK 日志：`⚠️ ACK timeout after 2000ms: sent=X, acked=Y, missing=Z, missing_sequences=[...]`
- SDK 日志：`Relying on stream_summary fallback mechanism`
- StreamTrace 记录：
  - `sdk_total_chunks` = X
  - `sse_chunk_count` = Y
  - `missing_sequences` = [具体丢失的序号]
  - `loss_position` = 'tail'（如果是尾部丢失）
  - `status` = 'anomaly'

### 4. 时序分析验证
**操作**：正常发送消息

**预期检查 StreamTrace**：
- `first_chunk_delay` > 0（首包延迟，毫秒）
- `avg_chunk_interval` > 0（平均间隔，毫秒）
- `last_chunk_delay` > 0（尾包延迟，毫秒）

## 监控面板检查

访问 `/admin/stream_traces`，检查最新记录：

### 正常记录应显示：
```
Status: completed
SDK Total Chunks: 60
SDK Chunks: 60
SSE Chunks: 60
Missing Sequences: []
Loss Position: -
First Chunk Delay: 3500ms
Avg Chunk Interval: 35ms
Last Chunk Delay: 15ms
```

### 异常记录应显示：
```
Status: anomaly
SDK Total Chunks: 60
SDK Chunks: 60
SSE Chunks: 57
Missing Sequences: [57, 58, 59]
Loss Position: tail
First Chunk Delay: 3200ms
Avg Chunk Interval: 32ms
Last Chunk Delay: 2010ms  (超时等待)
```

## 日志关键词

### Rails 日志
```
[BotChannel] Received stream_chunk #X for session Y
[BotChannel] ✅ ACK sent for chunk #X
[RokidSSE] Received stream_summary for session Y
[RokidSSE] Compensation check: SDK chunks=X, SSE sent=Y
```

### SDK 日志（OpenClaw）
```
[EyeClaw] Sending chunk #X to Rails
[EyeClaw] ✅ Received ACK for chunk #X, total acked: Y/Z
[EyeClaw] 🕒 Waiting for all ACKs: sent=X, acked=Y
[EyeClaw] ✅ All chunks ACKed: X/X in Yms
```

或超时情况：
```
[EyeClaw] ⚠️ ACK timeout after 2000ms: sent=X, acked=Y, missing=Z, missing_sequences=[...]
[EyeClaw] Relying on stream_summary fallback mechanism
```

## 成功标准
1. ✅ ACK 机制：95%+ 的请求在 200ms 内完成 ACK
2. ✅ 超时保护：超时后正确记录缺失的 sequence
3. ✅ 监控准确：StreamTrace 准确记录 SDK vs SSE 差异
4. ✅ 丢包定位：正确识别 head/middle/tail 丢包位置
5. ✅ 时序分析：首包延迟、平均间隔、尾包延迟数据合理

## 问题排查

### 如果 ACK 机制不工作
1. 检查 Rails 日志：是否发送 `✅ ACK sent for chunk #X`
2. 检查 SDK 日志：是否收到 `✅ Received ACK for chunk #X`
3. 检查 WebSocket 连接是否正常

### 如果监控数据不准确
1. 检查 `stream_summary` 是否正确发送
2. 检查 `StreamTrace.analyze_loss_details!` 是否被调用
3. 检查数据库字段是否正确更新

---

**测试人员**: 开发团队
**测试时间**: 2026-02-27
**预计测试时长**: 30分钟

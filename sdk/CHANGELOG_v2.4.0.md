# EyeClaw SDK v2.4.0 Changelog

## 🔥 重大更新：ACK 确认机制 + 详细监控

### 修复的问题
**根本原因分析**：
- SDK 在高速发送 chunks 后立即发送 `stream_end`，导致 Rails ActionCable 消息队列中的最后几个 chunks 还未处理完就关闭了连接
- 从生产日志看，SDK 发送了 60 个 chunks，但眼镜只收到 57 个（最后 3 个丢失）

### 新增功能

#### 1. ACK 确认机制（TCP 三次握手应用层实现）
- **Rails 端**：每收到一个 chunk 立即向 SDK 发送 `chunk_received` 确认消息
- **SDK 端**：
  - 维护 `sentChunks` 和 `ackedChunks` 计数器
  - 在 `stream_end` 前等待所有 chunks 被确认
  - 超时保护：2 秒后强制返回，依赖 `stream_summary` 兜底
  - 详细日志记录等待过程和超时情况

#### 2. 详细监控系统
**StreamTrace 新增字段**：
- `sdk_total_chunks`: SDK 发送的总 chunks 数量（从 stream_summary 获取）
- `missing_sequences`: 丢失的 chunk 序号列表（数组）
- `loss_position`: 丢包位置（`head`/`middle`/`tail`/`mixed`）
- `first_chunk_delay`: 首包延迟（毫秒）
- `avg_chunk_interval`: 平均 chunk 间隔（毫秒）
- `last_chunk_delay`: 尾包延迟（毫秒）

**监控能力**：
- 对比 SDK 发送数量 vs Rails 接收数量
- 精确定位丢包位置（开头/中间/结尾）
- 时序分析（首包延迟、平均间隔、尾包延迟）
- 丢失的具体 sequence 列表

### 技术细节

#### SDK 侧变化
```typescript
// 新增 ACK 追踪变量
private sentChunks = 0
private ackedChunks = new Set<number>()

// 发送 chunk 时记录
private sendChunk(content: string, sessionId?: string) {
  const sequence = this.chunkSequence++;
  this.sentChunks++;  // 记录已发送
  // ...
}

// 处理 ACK
if (payload.type === 'chunk_received') {
  this.ackedChunks.add(payload.sequence)
  // 日志记录
}

// 等待所有 ACK
private async waitForAllAcks() {
  while (this.ackedChunks.size < this.sentChunks) {
    if (timeout) break  // 2 秒超时
    await sleep(50ms)
  }
}
```

#### Rails 侧变化
```ruby
# BotChannel 立即发送 ACK
def stream_chunk(data)
  # ... 处理 chunk ...
  
  # 立即确认
  transmit({
    type: 'chunk_received',
    sequence: data['sequence'],
    session_id: data['session_id']
  })
end

# StreamTrace 详细分析
def analyze_loss_details!
  # 分析丢失的 sequence
  # 判断丢包位置
  # 计算时序指标
end
```

### 日志示例

**正常情况**（所有 ACK 收到）：
```
[EyeClaw] 🕒 Waiting for all ACKs: sent=60, acked=0
[EyeClaw] ✅ Received ACK for chunk #0, total acked: 1/60
...
[EyeClaw] ✅ All chunks ACKed: 60/60 in 145ms
```

**超时情况**（部分 ACK 丢失）：
```
[EyeClaw] 🕒 Waiting for all ACKs: sent=60, acked=57
[EyeClaw] ⚠️ ACK timeout after 2000ms: sent=60, acked=57, missing=3, missing_sequences=[57, 58, 59]
[EyeClaw] Relying on stream_summary fallback mechanism
```

### 生产环境验证

下次出现丢包问题时，StreamTrace 会记录：
- SDK 发送了 60 个 chunks
- Rails 只接收到 57 个
- 丢失的是 #57, #58, #59（尾部丢失）
- 首包延迟：3500ms
- 平均间隔：35ms
- 尾包延迟：10ms（SDK 等待 ACK 的时间）

### 向后兼容
- ACK 机制完全透明，不影响现有流程
- stream_summary 兜底机制依然有效
- 旧版本 SDK 可以继续工作（只是没有 ACK 优化）

---

**发布日期**: 2026-02-27
**影响范围**: SDK + Rails + StreamTrace 监控
**破坏性变更**: 无
**推荐操作**: 立即升级到生产环境，验证 ACK 机制效果

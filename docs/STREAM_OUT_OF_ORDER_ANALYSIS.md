# 流式输出乱序到达问题分析报告

## 问题背景

**时间**: 2026-03-03  
**环境**: 生产环境 (眼镜端实际使用)  
**现象**: 用户反馈"断联导致输出中断"

## 技术架构

```
SDK (客户端) 
  ↓ WebSocket (ActionCable)
BotChannel (服务端接收)
  ↓ ActionCable.broadcast
RokidSSE Controller (服务端发送)
  ↓ SSE (Rack Hijack)
Rokid 眼镜设备
```

## 日志分析结果

### 关键发现

**日志文件**: `eyeclaw-webapp-gzu8ct.1.coe0kza7uwndwiqm4c7mxeaw2-20260303_033101.log.txt`

1. **乱序现象确认**:
   - Line 57-62: sequence 收到顺序为 19 → 18 → 20
   - Line 108-115: sequence 收到顺序为 22 → 24 → 23 → 25
   
2. **无丢包证据**:
   - Line 155 最终验证: `SDK chunks=26, SSE sent=26` ✅ **完全匹配**
   - 所有 chunks 最终都正确到达并输出

3. **现有机制工作正常**:
   ```ruby
   # RokidSSE Controller 已有的乱序处理机制
   if sequence == next_expected_sequence
     # 立即输出
     write_sse_event_direct(io, 'message', event_data)
     next_expected_sequence += 1
     
     # 检查缓存中的后续 chunks
     while pending_chunks.key?(next_expected_sequence)
       # 输出缓存的 chunks
       next_expected_sequence += 1
     end
   elsif sequence > next_expected_sequence
     # 缓存乱序到达的 chunks
     pending_chunks[sequence] = content
   end
   ```

## 结论

### 服务端状态: ✅ 正常工作

- **乱序处理机制**: 通过 `pending_chunks` 缓存机制正确处理
- **数据完整性**: 26/26 chunks 全部送达，无丢包
- **输出顺序**: 最终按正确序号输出给眼镜端

### 真正问题分析

**用户反馈的"断联导致输出中断"问题不在服务端序号处理逻辑**

可能原因:

1. **客户端网络不稳定**
   - 眼镜设备 WiFi/4G 信号抖动
   - 导致 SSE 连接中断
   - 断连后未能自动重连或恢复流式输出

2. **SSE 连接管理**
   - 眼镜端 SSE 客户端实现问题
   - 断线检测不及时
   - 重连机制缺失或延迟

3. **补偿机制未触发**
   - `stream_summary` 补偿机制需要客户端主动请求
   - 如果客户端断连，可能无法触发补偿

## 已尝试方案 (已回滚)

### ❌ 方案: 添加 3 秒超时跳过机制

**实现思路**:
- 如果某个 sequence 超过 3 秒未到达，跳到下一个可用的缓存 sequence
- 目的: 避免长时间等待缺失的 sequence

**回滚原因**:
- **用户反馈正确**: "如果某个 sequence 超过 3 秒未到达会不会比之前更糟糕?"
- **问题分析**:
  - 3 秒延迟在实时对话场景下体验极差
  - 从日志看所有 chunks 最终都会到达，只是乱序
  - 添加超时会引入**人为卡顿**，比原问题更严重
- **结论**: 现有机制已经正确工作，无需添加超时

## 给客户端团队的建议

### 1. 排查网络稳定性

**优先级: 高**

- 检查眼镜设备的 WiFi/4G 连接稳定性
- 监控 SSE 连接断开频率和触发条件
- 记录网络环境参数 (信号强度、延迟、丢包率)

### 2. 优化 SSE 客户端实现

**优先级: 高**

```javascript
// 建议实现自动重连机制
const eventSource = new EventSource(url);

eventSource.onerror = (error) => {
  console.error('SSE 连接错误:', error);
  
  // 记录断连时间和已接收的 sequence
  const lastSequence = getLastReceivedSequence();
  
  // 延迟重连 (指数退避)
  setTimeout(() => {
    reconnectSSE(lastSequence);
  }, retryDelay);
};
```

### 3. 实现断点续传

**优先级: 中**

- 客户端记录最后接收的 sequence
- 断连重连后，通过 `stream_summary` 补偿机制获取缺失的 chunks
- 服务端已支持 `stream_summary` 接口

### 4. 添加客户端日志

**优先级: 中**

建议记录:
- SSE 连接建立/断开时间
- 每个 chunk 的接收时间和 sequence
- 断连时的网络状态
- 重连尝试和结果

### 5. 考虑降低 idle_timeout

**优先级: 低**

当前服务端配置:
```ruby
idle_timeout = 60  # 60 秒无数据则断开
```

如果需要更快发现断连，可以:
- 客户端实现心跳检测
- 或请求服务端降低 `idle_timeout` (需权衡性能)

## 服务端配置参考

### 当前 SSE 配置

```ruby
# app/controllers/rokid_sse_controller.rb

# 连接超时
idle_timeout = 60  # 秒

# 序号排序机制
pending_chunks = {}  # 缓存乱序 chunks
next_expected_sequence = 0  # 期望的下一个序号
```

### 补偿机制接口

**端点**: `POST /api/rokid/stream_summary`

**参数**:
```json
{
  "bot_id": "xxx",
  "session_id": "xxx"
}
```

**返回**: 完整的流式输出内容 (用于断线重连后的数据恢复)

## 监控建议

### 服务端

- 已有 `StreamTrace` 记录每次流式会话
- 管理后台可查看: `/admin/stream_traces`
- 关注指标:
  - SDK chunks vs SSE sent (应该始终相等)
  - 乱序 chunks 数量 (pending_chunks 使用情况)
  - 连接持续时间

### 客户端

- 建议添加:
  - SSE 连接成功率
  - 平均连接持续时间
  - 断连重连次数
  - 数据完整性验证 (收到的 chunks 数量)

## 总结

**服务端**: ✅ 无需修改，现有机制已正确处理乱序问题  
**客户端**: ⚠️ 需排查网络稳定性和连接管理逻辑  
**协作点**: 可通过 `stream_summary` 接口实现断点续传  

---

**创建时间**: 2026-03-03  
**分析人员**: AI Assistant  
**状态**: 待客户端团队跟进

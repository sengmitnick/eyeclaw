# StreamTrace 监控字段显示验证文档

## 问题描述
用户反馈 `/admin/stream_traces/55` 页面信息没有显示。经过检查发现数据库中只有 13 条记录，记录 #55 不存在。

## 解决方案
为 StreamTrace 的 show 和 index 页面添加了新增的 6 个监控字段的显示：

### 新增字段
1. **sdk_total_chunks** - SDK 发送的总 chunks 数量
2. **missing_sequences** - 丢失的 sequence 列表
3. **loss_position** - 丢包位置（head/middle/tail/mixed）
4. **first_chunk_delay** - 首包延迟（毫秒）
5. **avg_chunk_interval** - 平均 chunk 间隔（毫秒）
6. **last_chunk_delay** - 尾包延迟（毫秒）

## 页面改进

### Show 页面 (`app/views/admin/stream_traces/show.html.erb`)
添加了以下显示区块：

1. **SDK Total Chunks** - 显示 SDK 发送的总 chunks 数
2. **Missing Sequences** - 显示丢失的 sequence 列表（红色显示）或"None"（绿色）
3. **Loss Position** - 使用彩色标签显示丢包位置：
   - 🟡 head - 黄色
   - 🔴 tail - 红色
   - 🟠 middle - 橙色
   - 🟣 mixed - 紫色
4. **Timing Analysis** - 三列卡片显示：
   - 🔵 First Chunk Delay（首包延迟）
   - 🟢 Avg Chunk Interval（平均间隔）
   - 🟣 Last Chunk Delay（尾包延迟）

### Index 页面 (`app/views/admin/stream_traces/index.html.erb`)
优化了表格列，显示关键监控信息：

1. **Status 列** - 带图标的状态标签：
   - ⚠️ Anomaly（红色圆角标签）
   - ✓ Completed（绿色圆角标签）
   - 异常记录的行背景高亮为淡红色

2. **Chunks 列** - 显示传输情况：
   - 格式：`SDK总数 → SSE收到数`
   - SDK 数字显示为蓝色
   - SSE 数字根据情况显示：
     - 绿色：完全匹配
     - 红色：有丢失

3. **Loss 列** - 显示丢包详情：
   - 丢包位置标签（彩色）+ 丢失数量（红色字体）
   - 无丢包显示："✓ None"（绿色）

## 测试验证

### 1. 创建测试数据
运行以下脚本创建一个包含完整监控数据的 StreamTrace 记录：

```bash
rails runner tmp/test_stream_trace_display.rb
```

这将创建一个模拟"尾部丢包"场景的记录：
- SDK 发送 60 chunks
- SSE 收到 55 chunks
- 丢失的 sequences: [57, 58, 59]
- Loss position: tail
- 首包延迟: 150ms
- 平均间隔: 50ms
- 尾包延迟: 3ms

### 2. 访问页面
打开浏览器访问后台（需要管理员登录）：

**Index 页面：**
```
http://localhost:3000/admin/stream_traces
```

应该看到：
- 记录 #14 的行背景为淡红色（异常状态）
- Status 列显示红色的 "⚠️ Anomaly" 标签
- Chunks 列显示 "60 → 55"（蓝色 → 红色）
- Loss 列显示红色 "Tail" 标签 + "-3" 丢失数量

**Show 页面：**
```
http://localhost:3000/admin/stream_traces/14
```

应该看到：
- SDK Total Chunks: 60
- Missing Sequences: [57, 58, 59]（红色显示）
- Loss Position: 红色 "Tail" 标签
- Timing Analysis 三列卡片：
  - First Chunk Delay: 150ms（蓝色卡片）
  - Avg Chunk Interval: 50ms（绿色卡片）
  - Last Chunk Delay: 3ms（紫色卡片）

### 3. 数据库验证
验证新字段已正确保存：

```bash
rails runner "st = StreamTrace.find(14); puts st.attributes.slice('sdk_total_chunks', 'missing_sequences', 'loss_position', 'first_chunk_delay', 'avg_chunk_interval', 'last_chunk_delay').inspect"
```

预期输出：
```ruby
{
  "sdk_total_chunks"=>60,
  "missing_sequences"=>[57, 58, 59],
  "loss_position"=>"tail",
  "first_chunk_delay"=>150,
  "avg_chunk_interval"=>50,
  "last_chunk_delay"=>3
}
```

## 实际使用场景

当生产环境出现流式传输丢包问题时：

1. **快速定位** - Index 页面可以快速看到哪些记录有异常（红色高亮）
2. **丢包分析** - 通过 Loss Position 判断是头部、尾部还是中间丢包
3. **时序分析** - 通过 Timing Analysis 了解：
   - 首包延迟高 → 可能是网络连接慢或服务器响应慢
   - 平均间隔小 → 发送太快，可能导致队列积压
   - 尾包延迟小 → 最后几个包发送过快，来不及确认
4. **详细排查** - 通过 Missing Sequences 精确知道哪些包丢失了

## 与 ACK 机制的配合

新的监控系统与 ACK 机制完美配合：
- **ACK 机制** - 预防丢包（SDK 等待确认后才发送 stream_end）
- **监控系统** - 事后分析（记录详细的丢包信息和时序数据）
- **兜底方案** - stream_summary 补偿（超时后仍用完整内容兜底）

三层保护确保数据传输的可靠性和可追溯性。

## 文件清单

### 修改的文件
1. `app/views/admin/stream_traces/show.html.erb` - 添加新字段显示
2. `app/views/admin/stream_traces/index.html.erb` - 优化列表显示

### 测试文件
1. `tmp/test_stream_trace_display.rb` - 测试数据生成脚本

## 注意事项

1. **迁移已运行** - 确保运行了 `rails db:migrate` 添加新字段
2. **旧数据** - 现有的 StreamTrace 记录的新字段为空，只有新记录才会有完整数据
3. **管理员认证** - 访问 `/admin/stream_traces` 需要管理员登录
4. **实时更新** - 新的监控数据会在每次流式传输结束时自动记录

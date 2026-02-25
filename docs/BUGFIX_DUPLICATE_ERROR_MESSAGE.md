# Bug 修复：绑定错误消息重复显示

## 问题描述

在 Rokid 眼镜绑定流程中，当二维码识别失败时，用户会看到两次相同的错误提示：

```
未能识别二维码，请重新对准二维码后再试。
未能识别二维码，请重新对准二维码后再试。
```

这是一个用户体验问题，虽然不影响功能，但会让用户感到困惑。

## 问题原因

### 代码分析

在 `app/controllers/rokid_sse_controller.rb` 的 `handle_binding_photo_result_hijack` 方法中，错误处理使用了以下模式：

```ruby
# 原有代码（错误）
unless qr_content
  @@pending_binding_photos.delete(message_id)
  error_message = "未能识别二维码，请重新对准二维码后再试。"
  error_data = {
    role: 'agent',
    type: 'answer',
    answer_stream: error_message,  # 包含错误消息文本
    message_id: message_id,
    agent_id: agent_id,
    is_finish: true
  }
  write_sse_event_direct(io, 'message', error_data)
  write_sse_event_direct(io, 'done', error_data)  # ⚠️ 问题：done 事件也包含 answer_stream
  io.close
  return
end
```

### 根本原因

SSE (Server-Sent Events) 的架构中：
1. **`message` 事件**：用于传递实际内容（包含 `answer_stream` 字段）
2. **`done` 事件**：用于标记流结束（不应包含 `answer_stream`）

原代码中，两个事件都使用了相同的 `error_data`，导致：
- 第 1 次显示：`message` 事件的 `answer_stream: "未能识别二维码..."`
- 第 2 次显示：`done` 事件的 `answer_stream: "未能识别二维码..."`

客户端收到两个事件，都包含相同的错误消息，就会显示两次。

## 解决方案

### 修复策略

将 `done` 事件的数据单独定义，移除 `answer_stream` 字段：

```ruby
# 修复后代码（正确）
unless qr_content
  @@pending_binding_photos.delete(message_id)
  error_message = "未能识别二维码，请重新对准二维码后再试。"
  
  # 发送错误消息（包含 answer_stream）
  error_data = {
    role: 'agent',
    type: 'answer',
    answer_stream: error_message,  # 只在这里显示错误消息
    message_id: message_id,
    agent_id: agent_id,
    is_finish: true
  }
  write_sse_event_direct(io, 'message', error_data)
  
  # 发送结束标记（不包含 answer_stream）
  done_data = {
    role: 'agent',
    type: 'answer',
    message_id: message_id,
    agent_id: agent_id,
    is_finish: true
  }
  write_sse_event_direct(io, 'done', done_data)  # ✅ 修复：done 不包含 answer_stream
  io.close
  return
end
```

### 修改范围

在 `app/controllers/rokid_sse_controller.rb` 中修复了 5 处错误处理：

1. **二维码识别失败**（第 915-938 行）
   ```ruby
   unless qr_content
     # 错误消息："未能识别二维码，请重新对准二维码后再试。"
   ```

2. **无效绑定令牌**（第 946-968 行）
   ```ruby
   unless binding_token
     # 错误消息："无效的绑定令牌，请刷新网页后重新扫码。"
   ```

3. **令牌已使用或过期**（第 972-998 行）
   ```ruby
   unless binding_token.valid_for_binding?
     # 错误消息："此令牌已被使用..." 或 "令牌已过期..."
   ```

4. **Bot 已绑定其他设备**（第 1005-1027 行）
   ```ruby
   if bot.rokid_device_id.present? && bot.rokid_device_id != agent_id
     # 错误消息："此 Bot 已被其他设备绑定，请先解绑后再试。"
   ```

5. **绑定失败**（第 1057-1077 行）
   ```ruby
   else  # bot.update 失败
     # 错误消息："绑定失败，请稍后重试。"
   ```

## 验证测试

### 代码静态分析

运行验证脚本 `tmp/verify_fix.rb`：

```bash
cd /home/runner/app && ruby tmp/verify_fix.rb
```

**测试结果：**
```
============================================================
代码分析：验证错误消息不重复
============================================================

找到 8 处使用 done_data 发送 'done' 事件
找到 0 处直接使用 error_data 发送 'done' 事件

正在检查 done_data 的定义...
✅ 所有 done_data 都不包含 answer_stream 字段

============================================================
测试结果
============================================================
✅ PASS: 修复成功！

验证结果：
- 找到 8 处正确使用 done_data 发送 done 事件
- 所有 done_data 都不包含 answer_stream 字段
- 错误消息通过 'message' 事件发送一次（包含 answer_stream）
- 结束标记通过 'done' 事件发送一次（不包含 answer_stream）
- 用户只会看到一次错误提示 ✅
```

### 预期行为

**修复前：**
```
未能识别二维码，请重新对准二维码后再试。
未能识别二维码，请重新对准二维码后再试。
```

**修复后：**
```
未能识别二维码，请重新对准二维码后再试。
```

## 技术细节

### SSE 事件结构

正确的 SSE 流式响应应该是：

```
event: message
data: {"role":"agent","type":"answer","answer_stream":"错误消息文本","message_id":"xxx","agent_id":"yyy","is_finish":true}

event: done
data: {"role":"agent","type":"answer","message_id":"xxx","agent_id":"yyy","is_finish":true}
```

注意：
- `message` 事件包含 `answer_stream`（实际内容）
- `done` 事件不包含 `answer_stream`（只是结束标记）

### 最佳实践

在所有 SSE 响应中：
1. 内容通过 `message` 事件发送（可以有多个，用于流式输出）
2. 结束通过 `done` 事件发送（只有一个，标记流结束）
3. `done` 事件应该只包含元数据，不包含展示内容

## 影响范围

- **用户体验**：✅ 改善 - 不再看到重复错误消息
- **功能逻辑**：✅ 无影响 - 功能行为完全一致
- **安全性**：✅ 无影响 - 仅优化显示逻辑
- **向后兼容**：✅ 完全兼容 - 客户端仍然能正确处理响应

## 相关文档

- [安全绑定流程文档](./SECURE_BINDING_FLOW.md)
- Rokid SSE 控制器：`app/controllers/rokid_sse_controller.rb`

## 修复日期

2026-02-25

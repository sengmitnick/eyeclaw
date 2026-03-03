# Rokid 设备绑定失败问题诊断报告

## 问题描述

杭州用户（user_id: `36CFFA96BA8943F1936085813DBD86B0`）报告设备绑定失败，显示"设备已经绑定其他 Bot"。

## 日志分析

### 关键时间线（2026-03-03 11:36:00）

```
Line 2295-2300: 用户上传绑定照片
Line 2301-2303: QR 解码成功 → token: 9620c86ecca83b4c0be4d1a2a478f58b ✅
Line 2309: 请求完成 (204 No Content)
```

### 🚨 关键问题

**在 Line 2303 之后，日志突然中断，没有任何后续记录：**
- ❌ 没有成功消息 `"Successfully bound agent_id..."`
- ❌ 没有失败消息 `"Binding failed for Bot..."`
- ❌ 没有异常消息 `"Binding exception for Bot..."`
- ❌ 没有 SSE 写入日志 `"⏰ Writing message at..."`

## 代码分析

### 绑定流程（handle_binding_photo_result_hijack）

```ruby
Line 1178: Rails.logger.info "[RokidSSE] QR code decoded: #{qr_content}"  ✅ 执行到这里

# 4层预检查（Line 1180-1319）
Line 1181: binding_token = BindingToken.find_by(token: qr_content)
Line 1183-1206: 检查 token 是否存在
Line 1209-1236: 检查 token 是否有效
Line 1242-1266: 检查用户是否已绑定其他 Bot  ⚠️ 可能在这里失败
Line 1269-1293: 检查设备是否已绑定其他 Bot
Line 1296-1319: 检查 Bot 是否被其他用户绑定

Line 1324-1404: 执行绑定操作
```

### 问题推断

**最可能的原因：**

代码在 Line 1242-1319 的某一层预检查中检测到冲突并执行了：
```ruby
error_data = { ... }
write_sse_event_direct(io, 'message', error_data)  # ⚠️ 这里可能失败
...
io.close
return
```

**但为什么没有错误消息日志？**

查看 `write_sse_event_direct` 方法（Line 1124-1142）：
```ruby
def write_sse_event_direct(io, event_name, data)
  return unless io  # ⚠️ 如果 io 为 nil，直接返回
  
  start_time = Time.current
  begin
    timestamp_before = Time.current.strftime('%H:%M:%S.%3N')
    Rails.logger.info "[RokidSSE] ⏰ Writing #{event_name} at #{timestamp_before}"
    
    io.write "event: #{event_name}\n"
    io.write "data: #{data.to_json}\n\n"
    io.flush
    
    Rails.logger.info "[RokidSSE] ✅ Wrote+flushed #{event_name}..."
  rescue IOError, Errno::EPIPE => e
    Rails.logger.info "[RokidSSE] Client disconnected: #{e.message}"  # ⚠️ 只记录 IOError
  end
end
```

**可能的失败场景：**

1. **IO 对象为 nil** - `return unless io` 导致静默失败
2. **客户端已断开** - QR 解码耗时 2 秒，期间客户端超时断开连接
3. **IO 已关闭** - 在某个地方 `io` 被提前关闭

## 数据库查询结果

```bash
$ rails runner "Bot.where(rokid_user_id: '36CFFA96BA8943F1936085813DBD86B0')"
=> [] （用户未绑定任何 Bot）

$ rails runner "Bot.where(rokid_device_id: 'a4b8c2a2ef1342f1a4eb56dc492c2702')"
=> [] （设备未绑定任何 Bot）
```

**结论：数据库中没有冲突记录，预检查应该能通过！**

## 🎯 根本问题

**该用户的绑定流程在 Line 1178 之后失败，但失败原因没有被记录。**

### 可能性排查

#### ✅ 已排除
- ❌ 用户已绑定其他 Bot（数据库无记录）
- ❌ 设备已绑定其他 Bot（数据库无记录）
- ❌ Token 不存在（日志显示解码成功）

#### ⚠️ 待确认
1. **Token 有效性** - `binding_token.valid_for_binding?` 可能返回 false
2. **Token 已被使用** - `binding_token.used_at` 可能不为 nil
3. **Token 已过期** - 创建时间超过 5 分钟
4. **IO 连接问题** - 在预检查阶段 IO 对象失效

## 建议修复方案

### 方案 1：增强日志记录（推荐）

在所有 `return` 之前添加详细日志：

```ruby
# Line 1183-1206
unless binding_token
  Rails.logger.error "[RokidSSE] ❌ Binding token not found: #{qr_content}"  # 新增
  @@pending_binding_photos.delete(message_id)
  error_message = "无效的绑定令牌，请刷新网页后重新扫码。"
  # ... 发送错误
  return
end

# Line 1209-1236
unless binding_token.valid_for_binding?
  Rails.logger.error "[RokidSSE] ❌ Invalid token: #{binding_token.token}, used_at: #{binding_token.used_at}, expires_at: #{binding_token.expires_at}"  # 新增
  @@pending_binding_photos.delete(message_id)
  # ... 发送错误
  return
end

# Line 1242-1266
if existing_bot_by_user && existing_bot_by_user.id != bot.id
  Rails.logger.error "[RokidSSE] ❌ User #{user_id} already bound to Bot #{existing_bot_by_user.id}"  # 新增
  # ... 发送错误
  return
end
```

### 方案 2：检查 IO 状态

在每次 `write_sse_event_direct` 调用前检查 IO：

```ruby
def write_sse_event_direct(io, event_name, data)
  unless io
    Rails.logger.error "[RokidSSE] ❌ IO is nil, cannot write event: #{event_name}"
    return
  end
  
  if io.closed?
    Rails.logger.error "[RokidSSE] ❌ IO is closed, cannot write event: #{event_name}"
    return
  end
  
  # ... 原有逻辑
end
```

### 方案 3：捕获所有异常

在 `handle_binding_photo_result_hijack` 外层添加 catch-all：

```ruby
def handle_binding_photo_result_hijack(io, message_id, agent_id, user_id, image_url)
  begin
    Rails.logger.info "[RokidSSE] Processing binding photo result for agent_id: #{agent_id}"
    # ... 原有逻辑
  rescue => e
    Rails.logger.error "[RokidSSE] ❌ Unexpected error in binding flow: #{e.message}"
    Rails.logger.error e.backtrace.join("\n")
    # 尝试发送错误消息
    begin
      error_data = { ... }
      write_sse_event_direct(io, 'message', error_data)
    rescue
      # 静默失败
    end
  ensure
    io.close if io && !io.closed?
  end
end
```

## 下一步行动

1. **查询生产数据库** - 确认该 token 的状态：
   ```ruby
   BindingToken.find_by(token: "9620c86ecca83b4c0be4d1a2a478f58b")
   ```

2. **检查 BindingToken 表** - 确认 valid_for_binding? 逻辑：
   ```ruby
   token = BindingToken.find_by(token: "9620c86ecca83b4c0be4d1a2a478f58b")
   puts "Token exists: #{token.present?}"
   puts "Valid: #{token.valid_for_binding?}" if token
   puts "Used at: #{token.used_at}" if token
   puts "Expires at: #{token.expires_at}" if token
   puts "Created at: #{token.created_at}" if token
   ```

3. **应用修复** - 实施方案 1 + 方案 2，增强错误日志记录

4. **测试验证** - 在开发环境复现场景，确认错误消息能正确发送并记录

## 总结

杭州用户的绑定失败是由于代码在预检查阶段检测到问题并提前返回，但由于 IO 连接问题或日志缺失，导致：
- ✅ 用户没有收到错误提示（显示为"设备已绑定其他 Bot"可能是客户端的默认错误）
- ✅ 服务器日志中没有记录失败原因
- ✅ 数据库中没有绑定记录，预检查应该能通过

**最可能的原因是 token 有效性检查失败（已过期或已被使用），但错误消息没有成功发送到客户端。**

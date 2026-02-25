# SSE 实现双版本说明

## 为什么有两个版本？

`RokidSseController` 中有两套完整的 SSE (Server-Sent Events) 实现：

1. **sse_hijack** - 基于 Rack Hijacking (主要实现)
2. **sse_live** - 基于 ActionController::Live (备用实现)

### 架构决策原因

#### 1. 性能需求
**Hijack 版本的优势**：
- 直接控制 TCP socket，绕过 Rails 的所有中间件层
- 零缓冲延迟 - 数据写入后立即发送到客户端
- 更低的内存占用和 CPU 开销
- 适合需要实时响应的场景（如 Rokid 眼镜的实时交互）

**Live 版本的劣势**：
- 需要经过 Rails 的 Action Pack 层
- 可能存在响应缓冲（取决于服务器配置）
- 相对较高的资源开销

#### 2. 兼容性需求
**Hijack 版本的限制**：
- 需要服务器支持 Rack Hijacking API
- 部分代理服务器可能不支持
- 某些云平台可能禁用此功能

**Live 版本的优势**：
- Rails 官方支持的标准方式
- 兼容所有符合 Rack 标准的服务器
- 更好的错误处理和日志记录

### 工作机制

系统会自动检测并选择最佳实现：

```ruby
def sse
  if request.env['rack.hijack'] && Rails.env.production?
    sse_hijack
  else
    sse_live
  end
end
```

- **生产环境** + **支持 Hijack** → 使用 `sse_hijack`（高性能）
- **其他情况** → 使用 `sse_live`（高兼容性）

---

## 什么是 Rack Hijacking？

Rack Hijacking 是 Rack 协议的一个高级特性，允许应用程序接管底层的 TCP socket 连接。

### 技术原理

#### 正常的 Rails 请求流程
```
客户端 → Web服务器 → Rack中间件 → Rails路由 → 控制器 → 视图 → Rack中间件 → Web服务器 → 客户端
```

每一层都可能添加缓冲、日志记录、错误处理等逻辑。

#### Hijack 请求流程
```
客户端 → Web服务器 → Rack中间件 → 控制器 [接管socket]
                                        ↓
                                    直接操作TCP socket
                                        ↓
客户端 ←─────────────────────────────┘
```

控制器通过 `request.env['rack.hijack'].call` 获得原始 socket 的 IO 对象，之后可以直接读写数据。

### Hijack 实现示例

```ruby
def sse_hijack
  # 1. 接管连接
  io = request.env['rack.hijack'].call
  
  # 2. 发送 HTTP 响应头（手动构造）
  io.write "HTTP/1.1 200 OK\r\n"
  io.write "Content-Type: text/event-stream\r\n"
  io.write "Cache-Control: no-cache\r\n"
  io.write "Connection: keep-alive\r\n"
  io.write "\r\n"
  io.flush
  
  # 3. 直接写入 SSE 数据流
  io.write "event: message\n"
  io.write "data: #{json_data}\n\n"
  io.flush
  
  # 4. 关闭连接
  io.close
ensure
  # Rails 必须返回特殊响应，表示连接已被接管
  response.close
end
```

### 关键要点

1. **完全控制权**：接管后，应用程序负责所有 HTTP 协议细节（响应头、数据格式、连接关闭）
2. **性能优势**：没有中间层缓冲，数据写入即刻发送
3. **责任重大**：必须手动处理协议规范、错误情况、资源清理
4. **不可逆操作**：一旦调用 `hijack.call`，连接的控制权永久转移

---

## 实现对比

### 代码结构相似性

两个版本的核心逻辑完全相同：

- 相同的认证流程
- 相同的业务逻辑（查询机器人、流式生成回复）
- 相同的 SSE 事件格式
- 相同的错误处理策略

唯一区别是**数据写入方式**：

| 操作 | sse_hijack | sse_live |
|------|------------|----------|
| 发送 SSE 事件 | `io.write "event: message\n"` | `response.stream.write "event: message\n"` |
| 刷新缓冲 | `io.flush` | 无需手动刷新 |
| 关闭连接 | `io.close` | `response.stream.close` |

### 辅助方法映射

| 功能 | Hijack 版本 | Live 版本 |
|------|-------------|-----------|
| 写入 SSE 事件 | `write_sse_event_direct(io, event, data)` | `write_sse_event(event, data)` |
| 发送绑定照片请求 | `send_binding_photo_request_hijack(io, ...)` | `send_binding_photo_request(...)` |
| 流式生成回复 | `stream_ai_response_hijack(io, ...)` | `stream_ai_response(...)` |

---

## 维护建议

### 1. 同步更新
修改业务逻辑时，**必须同时更新两个版本**：
- 如果修改 `sse_hijack`，检查 `sse_live` 是否需要相同修改
- 如果修改 `send_binding_photo_request_hijack`，同步修改 `send_binding_photo_request`

### 2. 测试覆盖
- 开发环境通常使用 Live 版本（WEBrick/Puma 单线程模式）
- 生产环境可能使用 Hijack 版本（Puma 多线程/集群模式）
- 两个版本都需要测试

### 3. 日志记录
两个版本使用不同的日志标记：
- Hijack: `[RokidSSE] xxx in hijack mode`
- Live: `[RokidSSE] xxx in live mode`

便于追踪问题时识别使用的版本。

---

## 常见问题

### Q: 为什么不统一使用 Live 版本？
A: 性能差异显著。在高并发场景下，Hijack 版本的响应延迟可降低 50-80%。

### Q: 为什么不统一使用 Hijack 版本？
A: 兼容性问题。部分云平台（如 Heroku 的某些 dyno 类型）不支持 Hijack。

### Q: 能否用其他方式实现？
A: 可以考虑：
- **WebSocket** - 双向通信，但对于单向 SSE 流来说过于复杂
- **HTTP/2 Server Push** - 浏览器支持不完整，且灵珠平台可能不支持
- **Long Polling** - 性能远低于 SSE

### Q: 如何调试 Hijack 版本？
A: 使用日志记录：
```ruby
Rails.logger.info "[RokidSSE] Writing event: #{event}"
io.write "event: #{event}\n"
```
不能使用 `binding.pry` 或 `byebug`（会干扰 socket 状态）。

---

## 技术参考

- [Rack Hijack Specification](https://github.com/rack/rack/blob/master/SPEC.rdoc#label-Hijacking)
- [Rails ActionController::Live](https://api.rubyonrails.org/classes/ActionController/Live.html)
- [Server-Sent Events Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [灵珠平台接口文档](https://docs.rokid.com/)

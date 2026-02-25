# EyeClaw SDK v2.3.11 Release Notes

**Release Date:** 2025-02-25

## 🐛 Bug Fixes

### Fixed Ping/Pong "unrecognized command" Warning

**Problem:**
- Rails logs showed repeated warning: `Received unrecognized command in {"type"=>"pong"}`
- SDK incorrectly sent manual pong response to WebSocket protocol-level ping
- ActionCable framework rejected the message because it lacked a valid `command` field

**Root Cause:**
SDK was manually responding to WebSocket protocol-level ping frames:

```typescript
// ❌ Incorrect (before)
if (message.type === 'ping') {
  this.send({ type: 'pong' })  // Manually sends pong
  return
}
```

This caused ActionCable's `execute_command` method to receive `{ type: 'pong' }`, which is not a recognized command (`subscribe`, `unsubscribe`, or `message`).

**Solution:**
Removed manual pong response. WebSocket clients (browsers) automatically handle protocol-level ping/pong frames per RFC 6455.

```typescript
// ✅ Correct (after)
if (message.type === 'ping') {
  this.api.logger.debug('[EyeClaw] Received protocol-level ping (auto-handled by WebSocket)')
  return
}
```

## 📚 Understanding Ping/Pong Mechanisms

There are **two separate** ping/pong mechanisms in EyeClaw:

### 1. WebSocket Protocol-Level Ping/Pong (RFC 6455)

**Purpose:** Connection keepalive at transport layer

**How it works:**
- Server sends ping frame (opcode 0x9)
- Browser **automatically** responds with pong frame (opcode 0xA)
- No application code needed

**EyeClaw Implementation:**
- ActionCable server automatically sends protocol ping frames
- SDK only logs receipt, no manual response

### 2. Application-Level Ping/Pong (ActionCable Channel)

**Purpose:** Bot status updates and business logic

**How it works:**
```
SDK (every 60s)          Rails (BotChannel)
     |                          |
     |  action: 'ping'          |
     |------------------------->|
     |                          | @bot.ping!
     |                          | (updates last_seen_at)
     |  type: 'pong'            |
     |<-------------------------|
     |                          |
```

**Implementation:**

**SDK sends:**
```typescript
this.send({
  command: 'message',
  identifier: channelIdentifier,
  data: JSON.stringify({
    action: 'ping',
    timestamp: new Date().toISOString(),
  }),
})
```

**Rails handles:**
```ruby
def ping(data)
  @bot.ping!  # Update bot status
  
  transmit({
    type: 'pong',
    timestamp: Time.current.iso8601
  })
end
```

**SDK receives:**
```typescript
if (message.type === 'pong') {
  this.api.logger.debug('[EyeClaw] Received pong from server')
  return
}
```

## 🔄 Changes Made

### Modified Files

**`sdk/src/websocket-client.ts`:**
```diff
- // Ping/pong (协议级别的 ping，直接响应 pong)
+ // Ping/pong (WebSocket 协议级别的 ping 由浏览器自动响应，无需手动处理)
  if (message.type === 'ping') {
-   this.send({ type: 'pong' })
+   this.api.logger.debug('[EyeClaw] Received protocol-level ping (auto-handled by WebSocket)')
    return
  }
```

### Added Documentation

**`docs/PING_PONG_FIX.md`:**
- Detailed explanation of the two ping/pong mechanisms
- Root cause analysis of the warning
- Technical reference for future maintenance

## ✅ Verification

After this fix:

- ✅ No more "Received unrecognized command" warnings in Rails logs
- ✅ WebSocket connections remain stable (protocol-level keepalive works)
- ✅ Bot status updates continue to work (application-level ping/pong works)
- ✅ `@bot.ping!` updates `last_seen_at` every 60 seconds
- ✅ No functional changes or breaking changes

## 📊 Impact

**Before v2.3.11:**
```
11:39:19 web.1  | Received unrecognized command in {"type"=>"pong"}
11:39:22 web.1  | Received unrecognized command in {"type"=>"pong"}
11:39:25 web.1  | Received unrecognized command in {"type"=>"pong"}
```

**After v2.3.11:**
```
✅ Clean logs - no warnings
```

## 🔗 References

- [RFC 6455 - WebSocket Protocol (Ping/Pong)](https://datatracker.ietf.org/doc/html/rfc6455#section-5.5.2)
- [ActionCable Connection Subscriptions](https://github.com/rails/rails/blob/main/actioncable/lib/action_cable/connection/subscriptions.rb)
- [ActionCable Overview Guide](https://guides.rubyonrails.org/action_cable_overview.html)

---

**Full Changelog**: [v2.3.10...v2.3.11](https://github.com/eyeclaw/eyeclaw/compare/v2.3.10...v2.3.11)

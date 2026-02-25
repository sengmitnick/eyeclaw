# EyeClaw SDK v2.3.11 Release Summary

**Release Date:** 2025-02-25  
**Package:** `@eyeclaw/eyeclaw@2.3.11`  
**NPM URL:** https://www.npmjs.com/package/@eyeclaw/eyeclaw

## ✅ Release Completed Successfully

### Published to npm
```bash
✅ Successfully published @eyeclaw/eyeclaw@2.3.11
📦 Package Size: 11.6 kB (unpacked: 36.6 kB)
🔗 Registry: https://registry.npmjs.org/
```

### Installation
```bash
# OpenClaw users
openclaw plugins install @eyeclaw/eyeclaw

# Or update existing installation
openclaw plugins update @eyeclaw/eyeclaw
```

## 🐛 What's Fixed in v2.3.11

### Ping/Pong "unrecognized command" Warning

**Before:**
```
11:39:19 web.1  | Received unrecognized command in {"type"=>"pong"}
11:39:22 web.1  | Received unrecognized command in {"type"=>"pong"}
11:39:25 web.1  | Received unrecognized command in {"type"=>"pong"}
```

**After:**
```
✅ Clean logs - no warnings
```

**Root Cause:**
SDK was manually responding to WebSocket protocol-level ping frames, causing ActionCable to receive invalid commands.

**Fix:**
Removed manual pong response. WebSocket clients automatically handle protocol-level ping/pong per RFC 6455.

## 📄 Files Changed

### Updated Files
- `sdk/package.json` - Version bumped to 2.3.11
- `sdk/src/websocket-client.ts` - Fixed protocol-level ping handling

### New Files
- `sdk/CHANGELOG_v2.3.11.md` - Full release notes
- `docs/PING_PONG_FIX.md` - Technical documentation

## 🔍 Technical Details

### Two Ping/Pong Mechanisms

**1. WebSocket Protocol-Level (RFC 6455)**
- **Purpose:** Transport-layer connection keepalive
- **Handling:** Browser automatically responds to ping frames
- **Fix:** SDK no longer manually sends pong

**2. Application-Level (ActionCable Channel)**
- **Purpose:** Bot status updates and business logic
- **Frequency:** Every 60 seconds
- **Method:** `BotChannel#ping` via ActionCable message command
- **Unchanged:** Works as before

### Code Change
```diff
  if (message.type === 'ping') {
-   this.send({ type: 'pong' })
+   this.api.logger.debug('[EyeClaw] Received protocol-level ping (auto-handled by WebSocket)')
    return
  }
```

## ✅ Verification

### npm Registry Check
```bash
$ npm view @eyeclaw/eyeclaw version
2.3.11

$ npm view @eyeclaw/eyeclaw versions --json
[
  ...
  "2.3.8",
  "2.3.10",
  "2.3.11"
]
```

### Functionality Preserved
- ✅ WebSocket connections remain stable
- ✅ Bot status updates work correctly
- ✅ `@bot.ping!` updates `last_seen_at` every 60 seconds
- ✅ No functional changes or breaking changes
- ✅ All existing features continue to work

## 📚 Documentation

### Release Notes
- **Full Changelog:** `sdk/CHANGELOG_v2.3.11.md`
- **Technical Details:** `docs/PING_PONG_FIX.md`

### References
- [RFC 6455 - WebSocket Protocol](https://datatracker.ietf.org/doc/html/rfc6455#section-5.5.2)
- [ActionCable Subscriptions](https://github.com/rails/rails/blob/main/actioncable/lib/action_cable/connection/subscriptions.rb)
- [ActionCable Overview](https://guides.rubyonrails.org/action_cable_overview.html)

## 🚀 Next Steps for Users

### Existing Deployments
1. Update OpenClaw plugin:
   ```bash
   openclaw plugins update @eyeclaw/eyeclaw
   ```

2. Restart OpenClaw:
   ```bash
   openclaw restart
   ```

3. Verify in logs:
   - No more "Received unrecognized command" warnings
   - Bot connection status shows as online
   - Heartbeat logs appear every 60 seconds

### No Action Required
- This is a **bug fix release**
- No configuration changes needed
- No breaking changes
- Automatically works after update

## 📊 Impact

### Before v2.3.11
- ❌ Repeated warnings in Rails logs (every few seconds)
- ⚠️ Logs polluted with unnecessary error messages
- 🔍 Harder to spot real issues

### After v2.3.11
- ✅ Clean logs - only meaningful messages
- ✅ Easier debugging and monitoring
- ✅ Better developer experience

## 🎉 Success Metrics

- **Build:** ✅ Successful
- **Publish:** ✅ Successful
- **NPM Registry:** ✅ Verified
- **Version:** ✅ 2.3.11 live
- **Package Size:** ✅ 11.6 kB (optimized)
- **Files Included:** ✅ 9 files (index.ts, src/, README, LICENSE, etc.)

## 🔗 Links

- **NPM Package:** https://www.npmjs.com/package/@eyeclaw/eyeclaw
- **GitHub:** https://github.com/eyeclaw/eyeclaw
- **Documentation:** https://eyeclaw.io/docs
- **Issues:** https://github.com/eyeclaw/eyeclaw/issues

---

**Published by:** EyeClaw Team  
**SHA-256:** 7a36394a24e1c159ffd16837a0df0a72d2874a68  
**Integrity:** sha512-2cIqYXEilPDha...D/W9LHn2Pptlg==

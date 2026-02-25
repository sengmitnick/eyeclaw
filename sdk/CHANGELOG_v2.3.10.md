# EyeClaw SDK v2.3.10 Release Notes

**Release Date:** 2025-02-25

## ✨ New Features

### OpenClaw Session Management

**Problem:**
- Previously, each request to `/eyeclaw/chat` used a different session ID
- OpenClaw treated every request as a new conversation, unable to maintain context
- Users couldn't have continuous multi-turn conversations

**Solution:**
- Added `openclaw_session_id` parameter support throughout the stack
- When specified, OpenClaw maintains conversation context across multiple requests
- When unspecified, defaults to `bot_${botId}` for automatic session management per Bot

**How It Works:**

```
Rails → BotChannel → SDK → OpenClaw
  ↓                           ↑
  openclaw_session_id ──────────┘
```

1. **Rails Side**: Pass `openclaw_session_id` in metadata when calling execute_command
2. **SDK Side**: Extract `openclaw_session_id` from metadata and pass to OpenClaw Gateway
3. **OpenClaw Side**: Use session ID via `user` parameter in chat completions API

**Default Behavior:**
- If `openclaw_session_id` is not specified, SDK automatically uses `bot_${botId}`
- This means all requests from the same Bot share the same conversation context by default

**Custom Sessions:**
- Rails can specify different `openclaw_session_id` values to create separate conversation threads
- Example use cases:
  - Different users: `openclaw_session_id: "user_123"`
  - Different channels: `openclaw_session_id: "slack_thread_456"`
  - Temporary chats: `openclaw_session_id: "temp_#{SecureRandom.uuid}"`

## 📝 Technical Details

### Changes Made

**SDK (`sdk/src/websocket-client.ts`):**
```typescript
// Extract openclaw_session_id from metadata
const openclawSessionId = metadata?.openclaw_session_id || `bot_${this.config.botId}`

// Pass to processWithOpenClaw
await this.processWithOpenClaw(userMessage, sessionId, openclawSessionId)
```

**SDK (`sdk/src/http-handler.ts`):**
```typescript
const { message, session_id, openclaw_session_id } = body

// Use openclaw_session_id as OpenClaw session key
const sessionKey = openclaw_session_id || 'eyeclaw:default'

// Pass to OpenClaw in request body
openclawBody = {
  model: 'openclaw:main',
  stream: true,
  messages: [{ role: 'user', content: message }],
  user: sessionKey,  // ← This maintains conversation context
}
```

**Rails (`app/channels/bot_channel.rb`):**
```ruby
# Extract openclaw_session_id from metadata
openclaw_session_id = data['metadata']&.[]('openclaw_session_id') || "bot_#{@bot.id}"

# Forward to SDK
ActionCable.server.broadcast(
  "#{@stream_name}_mcp",
  {
    openclaw_session_id: openclaw_session_id,
    # ...
  }
)
```

**Rails (`app/controllers/rokid_sse_controller.rb`):**
```ruby
command_payload = {
  metadata: {
    openclaw_session_id: metadata['openclaw_session_id'] || "bot_#{bot.id}",
    # ...
  }
}
```

## 🔄 Migration Guide

### For Existing Deployments

1. **Update SDK**: Upgrade to v2.3.10
   ```bash
   cd sdk && npm install
   openclaw plugins update @eyeclaw/eyeclaw
   ```

2. **Update Rails Backend**: Deploy the updated Rails app
   - Updated `app/channels/bot_channel.rb`
   - Updated `app/controllers/rokid_sse_controller.rb`

3. **No Breaking Changes**: Existing code continues to work
   - Default behavior: All requests from same Bot share context
   - Explicit session management: Optional, only when needed

### Using Custom Sessions (Optional)

**Example 1: Per-User Sessions (Rokid Platform)**
```ruby
# In RokidSseController
metadata = {
  openclaw_session_id: "rokid_user_#{user_id}"
}
```

**Example 2: Per-Chat-Thread Sessions (Web Chat)**
```ruby
# In ChatController / BotChannel
metadata = {
  openclaw_session_id: "web_chat_#{conversation_id}"
}
```

**Example 3: Temporary Anonymous Sessions**
```ruby
metadata = {
  openclaw_session_id: "temp_#{SecureRandom.uuid}"
}
```

## 📊 Before & After

**Before (v2.3.9):**
```
User: "My name is Alice"
Bot: "Hello! How can I help you?"

User: "What's my name?"
Bot: "I don't have information about your name."  ❌
```

**After (v2.3.10 with session management):**
```
User: "My name is Alice"
Bot: "Hello Alice! How can I help you?"

User: "What's my name?"
Bot: "Your name is Alice."  ✅
```

## 🎯 Benefits

1. **Context Preservation**: OpenClaw remembers previous messages in the same session
2. **Flexible Session Management**: Support for both shared and isolated conversations
3. **Zero Configuration Required**: Works out of the box with sensible defaults
4. **Backward Compatible**: Existing deployments continue to work without changes

## 🔗 Related Documentation

- OpenClaw Agent CLI: https://docs.openclaw.ai/cli/agent
- Session Management: `openclaw agent --session-id <id> --message "..."`

---

**Full Changelog**: [v2.3.9...v2.3.10](https://github.com/eyeclaw/eyeclaw/compare/v2.3.9...v2.3.10)

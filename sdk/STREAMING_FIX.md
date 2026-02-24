# OpenClaw Streaming Fix

## Problem Identified

### Issue: Fake Streaming
From the logs, we discovered that the streaming was **fake** - all chunks arrived at once after a 7-second delay:

```
04:30:48 - Request received
04:30:55 - All chunks arrive simultaneously (7-second delay)
```

### Root Causes

1. **OpenClaw Agent Not Streaming in Real-Time**
   - The `openclaw agent` command without `--json` flag outputs complete response at once
   - No real-time token-by-token streaming

2. **SDK Filtering Logic Was Broken**
   - Original code filtered out lines starting with `{` or `[`
   - This removed JSON-formatted responses from OpenClaw Agent
   - Code assumed plain text output, but OpenClaw may use structured JSON

```typescript
// OLD - BROKEN CODE
if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
  // This skipped all JSON responses!
  client.sendStreamChunk('stream_chunk', streamId, line + '\n')
}
```

## Solution

### Changes Made

1. **Enable JSON Output**
   - Added `--json` flag to get structured streaming output
   - Added `--local` flag for immediate local execution

2. **Smart JSON Parsing**
   - Parse JSON lines for structured chunks
   - Fallback to plain text if parsing fails
   - Support multiple JSON response formats:
     - `{ type: 'chunk', content: '...' }`
     - `{ output: '...' }`
     - `{ content: '...' }`
     - `{ text: '...' }`

3. **Buffer Management**
   - Use `jsonBuffer` to handle incomplete JSON lines
   - Properly split and parse multi-line responses

### New Code

```typescript
// Spawn openclaw agent process for JSON streaming output
const agentProcess = spawn('openclaw', [
  'agent',
  '--session-id', 'eyeclaw-web-chat',
  '--message', message,
  '--json',  // Enable JSON output for structured streaming
  '--local', // Run locally for immediate response
])

let jsonBuffer = ''

agentProcess.stdout?.on('data', (data: Buffer) => {
  const text = data.toString()
  jsonBuffer += text
  
  // Split by newlines, keeping incomplete line in buffer
  const lines = jsonBuffer.split('\n')
  jsonBuffer = lines.pop() || ''
  
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    
    try {
      // Try parsing as JSON
      const json = JSON.parse(trimmed)
      
      // Handle different response types
      if (json.type === 'chunk' && json.content) {
        client.sendStreamChunk('stream_chunk', streamId, json.content)
      } else if (json.output || json.content || json.text) {
        const content = json.output || json.content || json.text
        client.sendStreamChunk('stream_chunk', streamId, content)
      }
    } catch (parseError) {
      // Not JSON, send as plain text
      client.sendStreamChunk('stream_chunk', streamId, trimmed + '\n')
    }
  }
})
```

## Testing

### Prerequisites
Ensure OpenClaw is properly configured:
```bash
openclaw doctor --fix
```

### Test Real Streaming

1. **Start EyeClaw Server**
   ```bash
   bin/dev
   ```

2. **Start OpenClaw Gateway**
   ```bash
   openclaw gateway start
   ```

3. **Send Test Message via Dashboard**
   - Navigate to Bot control panel
   - Send a message
   - Watch the terminal for streaming logs

### Expected Behavior

**Before Fix:**
- 5-10 second delay
- All content arrives at once
- Logs show simultaneous timestamps

**After Fix:**
- Real-time streaming
- Chunks arrive incrementally
- Logs show progressive timestamps
- Each chunk appears as it's generated

## Next Steps

1. **Verify OpenClaw Agent Supports Real Streaming**
   - Test `openclaw agent --json --local --message "test"` directly
   - Check if output is truly streamed or batched

2. **If OpenClaw Agent Doesn't Stream:**
   - May need to use OpenClaw's native streaming API
   - Consider using OpenClaw's HTTP/WebSocket API instead of CLI
   - Contact OpenClaw team for streaming support

3. **Performance Optimization**
   - Consider batching tiny chunks (< 5 chars) to reduce overhead
   - Add configurable buffer size for optimal streaming

## Known Limitations

- OpenClaw Agent CLI may not support true token-by-token streaming
- The `--json` flag output format may vary between OpenClaw versions
- Local execution (`--local`) requires API keys in environment

## References

- OpenClaw Agent Docs: https://docs.openclaw.ai/cli/agent
- SDK Implementation: `sdk/src/channel.ts` lines 189-243
- ActionCable Streaming: `app/channels/bot_channel.rb`

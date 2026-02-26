# EyeClaw SDK v2.3.12 Release Notes

**Release Date:** 2026-02-26

## 🛡️ Packet Loss Detection & Compensation

### Problem

Rokid glasses occasionally experience packet loss during SSE streaming:

- **OpenClaw output:** "润胜，你直说吧。🦞 到底想聊什么？还是就想测测我的耐心？"
- **Glasses received:** Only "润" (first character)

The issue was difficult to diagnose because:
- Logs have length limits (5000 chars)
- No way to trace which环节 failed
- No compensation mechanism to recover lost data

### Solution

**1. Stream Tracing System**

Added `stream_summary` message sent at end of stream:

```typescript
{
  type: "stream_summary",
  session_id: "xxx",
  total_content: "完整内容",
  total_chunks: 50,
  content_hash: "abc123"
}
```

**2. Compensation Mechanism**

Rails compares:
- `sdk_chunk_count` - chunks received from SDK
- `sse_chunk_count` - chunks actually sent to glasses

If difference ≥ 3 chunks or content length diff > 20 chars, automatically sends compensation data.

### Changes

**`sdk/src/websocket-client.ts`:**

```typescript
// Added: Accumulate full content for compensation
private accumulatedContent = ''

// Modified: Track chunks as sent
private sendChunk(content: string, sessionId?: string) {
  this.accumulatedContent += content;
  // ... send chunk
}

// Added: Send stream_summary at end
private sendStreamSummary(sessionId?: string) {
  const contentHash = this.hashCode(this.accumulatedContent);
  this.sendMessage('stream_summary', {
    session_id: sessionId,
    total_content: this.accumulatedContent,
    total_chunks: this.chunkSequence,
    content_hash: contentHash,
  })
  this.accumulatedContent = ''; // Reset for next session
}
```

### Benefits

1. **Traceability**: Every request gets unique `trace_id` for debugging
2. **Automatic Recovery**: Lost packets are automatically compensated
3. **Admin Dashboard**: View all traces at `/admin/stream_traces`
4. **Anomaly Detection**: Flags requests with packet loss for investigation

---

**Full Changelog**: [v2.3.11...v2.3.12](https://github.com/eyeclaw/eyeclaw/compare/v2.3.11...v2.3.12)

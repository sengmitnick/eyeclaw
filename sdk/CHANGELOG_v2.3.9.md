# EyeClaw SDK v2.3.9 Release Notes

**Release Date:** 2025-02-25

## 🐛 Bug Fixes

### Fixed: Stream Chunk Ordering Issue

**Problem:**
- When OpenClaw sends SSE chunks rapidly, multiple chunks may be packed into a single TCP packet
- SDK's `reader.read()` receives all chunks at once and sends them via WebSocket quickly
- Due to WebSocket's asynchronous network layer, chunks may arrive at Rails in wrong order
- This caused garbled text in streaming responses (e.g., "哎呀，好还是有点问题需要你龙虾** 了")

**Solution:**
- Added `chunkSequence` counter to track chunk order
- Each chunk now includes a `sequence` field (0, 1, 2, ...)
- Sequence is reset at the start of each new session
- Rails backend can now reorder chunks based on sequence number

**Changes:**
- Added `private chunkSequence = 0` to `EyeClawWebSocketClient` class
- Reset `chunkSequence` to 0 in `processWithOpenClaw()` method
- Include `sequence` field in `stream_chunk` messages sent to Rails

**Backend Requirements:**
- Rails backend must implement ordered queue logic to reorder chunks by sequence
- See `app/controllers/rokid_sse_controller.rb` and `app/channels/bot_channel.rb`

## 📝 Technical Details

### Root Cause Analysis

1. **TCP Packet Batching**: When OpenClaw sends chunks rapidly (within milliseconds), they may be bundled into a single TCP packet
2. **Batch Processing**: SDK's `reader.read()` retrieves the entire TCP packet, containing multiple SSE events
3. **Fast WebSocket Sends**: The `for (const line of lines)` loop processes all chunks and calls `ws.send()` multiple times quickly
4. **Network Layer Race Condition**: Multiple rapid `ws.send()` calls may result in out-of-order delivery at the network layer
5. **No Application-Level Ordering**: Without sequence numbers, Rails has no way to detect or correct the disorder

### Why Sequence Numbers Work

- ✅ **Independent of Network**: Sequence is determined at send time, not arrival time
- ✅ **Preserves Logical Order**: Application-level ordering guarantee
- ✅ **Handles Out-of-Order**: Rails can buffer early-arriving chunks and output them in correct order
- ✅ **Minimal Latency**: Only out-of-order chunks are buffered; in-order chunks output immediately

## 🔄 Migration Guide

### For Existing Deployments

1. **Update SDK**: Upgrade to v2.3.9
   ```bash
   openclaw plugins update @eyeclaw/eyeclaw
   ```

2. **Update Rails Backend**: Ensure your Rails app includes the ordered queue logic
   - Update `app/channels/bot_channel.rb` to forward `sequence` field
   - Update `app/controllers/rokid_sse_controller.rb` to implement ordering logic

3. **Restart Services**: Restart both OpenClaw SDK and Rails server

### Backward Compatibility

The SDK maintains backward compatibility:
- If Rails backend doesn't expect `sequence` field, it will simply ignore it
- Old Rails versions will continue to work (but without ordering guarantee)

## 📊 Testing Results

**Before Fix:**
```
Input:  "哎呀，好的！我现在是 **龙虾** 了"
Output: "哎呀，好还是有点问题需要你龙虾** 了" (garbled)
```

**After Fix:**
```
Input:  "哎呀，好的！我现在是 **龙虾** 了"
Output: "哎呀，好的！我现在是 **龙虾** 了" (correct)
```

## 🙏 Credits

Thanks to the EyeClaw team for identifying and fixing this subtle race condition issue!

---

**Full Changelog**: [v2.3.8...v2.3.9](https://github.com/eyeclaw/eyeclaw/compare/v2.3.8...v2.3.9)

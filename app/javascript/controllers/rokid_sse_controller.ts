import { Controller } from "@hotwired/stimulus"

// RokidSseController
// 处理 Rokid SSE 流式响应（内部使用，无 UI）
// 这些是服务器端广播，不需要实际的前端逻辑
export default class extends Controller {
  connect() {
    console.log("[RokidSSE] Controller connected (internal stream handler)")
  }

  // stream_chunk - 服务器推送的流式内容块
  handleStreamChunk(data: { content: string; sequence: number; session_id: string }) {
    // 内部流处理，无需 UI 操作
  }

  // stream_end - 流结束
  handleStreamEnd(data: { session_id: string }) {
    // 内部流处理，无需 UI 操作
  }

  // stream_error - 流错误
  handleStreamError(data: { error: string; session_id: string }) {
    // 内部流处理，无需 UI 操作
  }

  // stream_summary - 兜底机制摘要
  handleStreamSummary(data: { total_content: string; total_chunks: number; session_id: string }) {
    // 内部流处理，无需 UI 操作
  }
}

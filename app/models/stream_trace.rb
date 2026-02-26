class StreamTrace < ApplicationRecord
  # 状态常量
  STATUSES = %w[pending active completed anomaly].freeze

  # 事件类型
  EVENT_TYPES = %w[
    request_received
    command_broadcast
    sdk_chunk_received
    sse_chunk_sent
    stream_end
    stream_summary_received
    anomaly_detected
    compensation_sent
  ].freeze

  # JSON 序列化 events
  serialize :events, Array
  serialize :anomaly, Hash

  # 关联
  belongs_to :bot, optional: true

  # 验证
  validates :trace_id, presence: true, uniqueness: true
  validates :status, inclusion: { in: STATUSES }

  # 作用域
  scope :recent, -> { order(created_at: :desc).limit(100) }
  scope :with_anomalies, -> { where("anomaly IS NOT NULL AND anomaly != ''").order(created_at: :desc) }

  # 添加事件
  def add_event(event_type, data = {})
    events ||= []
    events << {
      type: event_type,
      data: data,
      timestamp: Time.current.iso8601
    }
    update_column(:events, events)
  end

  # 记录 SDK 收到的 chunk
  def record_sdk_chunk(content, sequence)
    self.sdk_chunk_count += 1
    self.sdk_content ||= ""
    self.sdk_content += content
    add_event(:sdk_chunk_received, {
      sequence: sequence,
      content_preview: content[0..50],
      content_length: content.length,
      total_sdk_chunks: sdk_chunk_count
    })
    save!
  end

  # 记录 SSE 发送的 chunk
  def record_sse_chunk(content, sequence)
    self.sse_chunk_count += 1
    self.sse_content ||= ""
    self.sse_content += content
    add_event(:sse_chunk_sent, {
      sequence: sequence,
      content_preview: content[0..50],
      content_length: content.length,
      total_sse_chunks: sse_chunk_count
    })
    save!
  end

  # 检测异常
  def detect_anomaly!
    return unless sdk_chunk_count > 0

    diff = sdk_chunk_count - sse_chunk_count
    content_diff = (sdk_content&.length || 0) - (sse_content&.length || 0)

    if diff >= 3 || content_diff.abs > 50
      anomaly_data = {
        type: diff >= 3 ? 'chunk_count_mismatch' : 'content_length_mismatch',
        sdk_chunk_count: sdk_chunk_count,
        sse_chunk_count: sse_chunk_count,
        sdk_content_length: sdk_content&.length || 0,
        sse_content_length: sse_content&.length || 0,
        diff: diff,
        content_diff: content_diff,
        detected_at: Time.current.iso8601
      }
      self.anomaly = anomaly_data
      self.status = 'anomaly'
      add_event(:anomaly_detected, anomaly_data)
      save!
      anomaly_data
    end
  end

  # 获取摘要
  def summary
    {
      trace_id: trace_id,
      message_id: message_id,
      agent_id: agent_id,
      bot_id: bot_id,
      status: status,
      sdk_chunks: sdk_chunk_count,
      sse_chunks: sse_chunk_count,
      sdk_length: sdk_content&.length || 0,
      sse_length: sse_content&.length || 0,
      created_at: created_at,
      updated_at: updated_at
    }
  end
end

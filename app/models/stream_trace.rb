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
  serialize :missing_sequences, Array

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
      
      # 🔥 添加详细监控数据
      analyze_loss_details!(anomaly_data)
      
      self.anomaly = anomaly_data
      self.status = 'anomaly'
      add_event(:anomaly_detected, anomaly_data)
      save!
      anomaly_data
    end
  end
  
  # 🔥 分析丢包的详细信息
  def analyze_loss_details!(anomaly_data = {})
    sdk_events = events.select { |e| e[:type] == 'sdk_chunk_received' }.sort_by { |e| e[:data][:sequence] || 0 }
    sse_events = events.select { |e| e[:type] == 'sse_chunk_sent' }.sort_by { |e| e[:data][:sequence] || 0 }
    
    # 记录 SDK 总 chunks 数
    self.sdk_total_chunks = sdk_events.map { |e| e[:data][:sequence] }.compact.max.to_i + 1 if sdk_events.any?
    
    # 分析丢失的 sequence
    sdk_sequences = sdk_events.map { |e| e[:data][:sequence] }.compact.sort
    sse_sequences = sse_events.map { |e| e[:data][:sequence] }.compact.sort
    missing = sdk_sequences - sse_sequences
    self.missing_sequences = missing
    
    # 分析丢包位置
    if missing.any? && sdk_sequences.any?
      max_seq = sdk_sequences.max
      first_quarter = max_seq / 4
      last_quarter = max_seq * 3 / 4
      
      loss_at_head = missing.any? { |s| s < first_quarter }
      loss_at_tail = missing.any? { |s| s > last_quarter }
      loss_at_middle = missing.any? { |s| s >= first_quarter && s <= last_quarter }
      
      if loss_at_tail && !loss_at_head
        self.loss_position = 'tail'
      elsif loss_at_head && !loss_at_tail
        self.loss_position = 'head'
      elsif loss_at_middle
        self.loss_position = 'middle'
      else
        self.loss_position = 'mixed'
      end
    end
    
    # 分析时序（毫秒）
    if sdk_events.size >= 2
      request_time = events.find { |e| e[:type] == 'request_received' }&.[](:timestamp)
      first_chunk_time = sdk_events.first[:timestamp]
      last_chunk_time = sdk_events.last[:timestamp]
      
      if request_time && first_chunk_time
        self.first_chunk_delay = ((Time.parse(first_chunk_time) - Time.parse(request_time)) * 1000).to_i
      end
      
      if sdk_events.size >= 2
        intervals = []
        sdk_events.each_cons(2) do |a, b|
          interval = ((Time.parse(b[:timestamp]) - Time.parse(a[:timestamp])) * 1000).to_i
          intervals << interval
        end
        self.avg_chunk_interval = (intervals.sum.to_f / intervals.size).to_i if intervals.any?
      end
      
      if last_chunk_time
        stream_end_time = events.find { |e| e[:type] == 'stream_end' }&.[](:timestamp)
        if stream_end_time
          self.last_chunk_delay = ((Time.parse(stream_end_time) - Time.parse(last_chunk_time)) * 1000).to_i
        end
      end
    end
    
    # 将分析结果添加到 anomaly_data
    anomaly_data.merge!({
      sdk_total_chunks: self.sdk_total_chunks,
      missing_sequences: self.missing_sequences,
      loss_position: self.loss_position,
      first_chunk_delay_ms: self.first_chunk_delay,
      avg_chunk_interval_ms: self.avg_chunk_interval,
      last_chunk_delay_ms: self.last_chunk_delay
    })
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
      sdk_total_chunks: sdk_total_chunks,
      missing_sequences: missing_sequences,
      loss_position: loss_position,
      first_chunk_delay_ms: first_chunk_delay,
      avg_chunk_interval_ms: avg_chunk_interval,
      last_chunk_delay_ms: last_chunk_delay,
      created_at: created_at,
      updated_at: updated_at
    }
  end
end

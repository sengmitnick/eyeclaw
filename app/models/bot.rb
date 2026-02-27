class Bot < ApplicationRecord
  belongs_to :user
  has_many :bot_sessions, dependent: :destroy
  has_many :binding_tokens, dependent: :destroy
  has_one :active_session, -> { where('last_ping_at > ?', 5.minutes.ago).order(last_ping_at: :desc) }, class_name: 'BotSession'

  # Validations
  validates :name, presence: true, length: { maximum: 255 }
  validates :status, inclusion: { in: %w[offline online connecting error] }
  validates :api_key, presence: true, uniqueness: true
  validates :sdk_token, presence: true, uniqueness: true
  validates :webhook_url, format: { with: URI::DEFAULT_PARSER.make_regexp(%w[http https]), allow_blank: true }
  validates :rokid_device_id, uniqueness: true, allow_blank: true
  validates :rokid_user_id, uniqueness: true, allow_blank: true

  # Callbacks
  before_validation :generate_api_key, on: :create, unless: :api_key?
  before_validation :generate_sdk_token, on: :create, unless: :sdk_token?

  # Scopes
  scope :online, -> { where(status: 'online') }
  scope :offline, -> { where(status: 'offline') }

  # Instance methods
  
  # agent_id 可以是 rokid_device_id（Rokid 眼镜）或 bot.id（Web Chat）
  # 优先通过 rokid_user_id（用户ID）查找，这样可以防止他人盗用眼镜
  def agent_id
    rokid_device_id.presence || id.to_s
  end

  # 通过 user_id 查找已绑定该用户的 Bot
  def self.find_by_rokid_user(user_id)
    return nil if user_id.blank?
    find_by(rokid_user_id: user_id)
  end
  
  def online?
    # Bot 在线 = 状态为 online AND 有活跃会话
    status == 'online' && active_session.present?
  end

  def offline?
    !online?
  end

  def connect!(session_id)
    transaction do
      update!(status: 'online')
      bot_sessions.create!(
        session_id: session_id,
        connected_at: Time.current,
        last_ping_at: Time.current
      )
    end
  end

  # Called when WebSocket disconnects (deployment or network issue)
  # Immediately marks as offline - SDK will reconnect if it's just a deployment
  def disconnect!
    update!(status: 'offline')
    active_session&.update!(last_ping_at: 5.minutes.ago)
  end

  # Called when SDK sends ping - if was offline, confirm reconnect
  # This handles the case where SDK reconnects after deployment
  def ping!
    session = active_session
    if session
      # Normal ping - just update timestamp
      session.update!(last_ping_at: Time.current)
      
      # If status is offline but we have an active session, it means SDK reconnected
      # after deployment - restore online status
      if status == 'offline'
        Rails.logger.info "[Bot] #{id} reconnected via ping, restoring online status"
        update!(status: 'online')
      end
    else
      # No active session - create one (SDK reconnected after longer outage)
      Rails.logger.info "[Bot] #{id} reconnected with new session"
      session_id = SecureRandom.uuid
      connect!(session_id)
    end
  end

  private

  def generate_api_key
    self.api_key = SecureRandom.hex(32)
  end

  def generate_sdk_token
    self.sdk_token = SecureRandom.hex(32)
  end

  def rokid_mcp_url
    "#{ENV.fetch('APP_HOST', 'http://localhost:3000')}/mcp/rokid"
  end
end

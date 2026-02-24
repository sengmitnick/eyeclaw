class Bot < ApplicationRecord
  belongs_to :user
  has_many :bot_sessions, dependent: :destroy
  has_one :active_session, -> { where('last_ping_at > ?', 5.minutes.ago).order(last_ping_at: :desc) }, class_name: 'BotSession'

  # Validations
  validates :name, presence: true, length: { maximum: 255 }
  validates :status, inclusion: { in: %w[offline online connecting error] }
  validates :api_key, presence: true, uniqueness: true
  validates :sdk_token, presence: true, uniqueness: true
  validates :webhook_url, format: { with: URI::DEFAULT_PARSER.make_regexp(%w[http https]), allow_blank: true }
  validates :rokid_device_id, uniqueness: true, allow_blank: true

  # Callbacks
  before_validation :generate_api_key, on: :create, unless: :api_key?
  before_validation :generate_sdk_token, on: :create, unless: :sdk_token?

  # Scopes
  scope :online, -> { where(status: 'online') }
  scope :offline, -> { where(status: 'offline') }

  # Instance methods
  
  # agent_id 可以是 rokid_device_id（Rokid 眼镜）或 bot.id（Web Chat）
  def agent_id
    rokid_device_id.presence || id.to_s
  end
  
  def online?
    # 只要有活跃的会话就认为是在线状态
    active_session.present?
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

  def disconnect!
    update!(status: 'offline')
    active_session&.update!(last_ping_at: 5.minutes.ago)
  end

  def ping!
    active_session&.update!(last_ping_at: Time.current)
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

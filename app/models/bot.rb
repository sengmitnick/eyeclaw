class Bot < ApplicationRecord
  belongs_to :user
  has_many :bot_sessions, dependent: :destroy
  has_one :active_session, -> { where('last_ping_at > ?', 5.minutes.ago).order(last_ping_at: :desc) }, class_name: 'BotSession'

  # Validations
  validates :name, presence: true, length: { maximum: 255 }
  validates :status, inclusion: { in: %w[offline online connecting error] }
  validates :api_key, presence: true, uniqueness: true
  validates :sdk_token, presence: true, uniqueness: true
  validates :mcp_url, format: { with: URI::DEFAULT_PARSER.make_regexp(%w[http https]), allow_blank: true }
  validates :webhook_url, format: { with: URI::DEFAULT_PARSER.make_regexp(%w[http https]), allow_blank: true }

  # Callbacks
  before_validation :generate_api_key, on: :create, unless: :api_key?
  before_validation :generate_sdk_token, on: :create, unless: :sdk_token?
  before_validation :generate_mcp_url, on: :create, unless: :mcp_url?

  # Scopes
  scope :online, -> { where(status: 'online') }
  scope :offline, -> { where(status: 'offline') }

  # Instance methods
  def online?
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

  def generate_mcp_url
    self.mcp_url = Rails.application.routes.url_helpers.mcp_bot_url(self, host: ENV.fetch('APP_HOST', 'localhost:3000'))
  rescue
    # URL generation might fail before save, will be updated after
  end
end

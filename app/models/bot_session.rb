class BotSession < ApplicationRecord
  belongs_to :bot

  # Validations
  validates :session_id, presence: true, uniqueness: true
  validates :connected_at, presence: true
  validates :last_ping_at, presence: true

  # Callbacks
  before_validation :set_timestamps, on: :create

  # Scopes
  scope :active, -> { where('last_ping_at > ?', 5.minutes.ago) }
  scope :inactive, -> { where('last_ping_at <= ?', 5.minutes.ago) }

  # Instance methods
  def active?
    last_ping_at && last_ping_at > 5.minutes.ago
  end

  def inactive?
    !active?
  end

  def duration
    return 0 unless connected_at
    (last_ping_at || Time.current) - connected_at
  end

  private

  def set_timestamps
    self.connected_at ||= Time.current
    self.last_ping_at ||= Time.current
  end
end

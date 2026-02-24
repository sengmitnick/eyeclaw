class AccessKey < ApplicationRecord
  # Validations
  validates :name, presence: true
  validates :key, presence: true, uniqueness: true
  
  # Callbacks
  before_validation :generate_key, on: :create, unless: :key?
  
  # Scopes
  scope :active, -> { where(is_active: true) }
  
  # Class methods
  def self.valid_key?(key)
    active.exists?(key: key)
  end
  
  def self.find_and_touch(key)
    access_key = active.find_by(key: key)
    access_key&.touch(:last_used_at)
    access_key
  end
  
  # Instance methods
  def deactivate!
    update!(is_active: false)
  end
  
  def activate!
    update!(is_active: true)
  end
  
  private
  
  def generate_key
    self.key = "ak_#{SecureRandom.hex(32)}"
  end
end

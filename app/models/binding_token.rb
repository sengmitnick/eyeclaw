class BindingToken < ApplicationRecord
  belongs_to :bot
  
  validates :token, presence: true, uniqueness: true
  validates :expires_at, presence: true
  
  # 生成随机令牌
  before_validation :generate_token, on: :create
  before_validation :set_expiration, on: :create
  after_create :cleanup_old_tokens
  
  # 检查令牌是否有效
  def valid_for_binding?
    return false if used_at.present? # 已使用
    return false if expires_at < Time.current # 已过期
    true
  end
  
  # 标记为已使用
  def mark_as_used!(device_id)
    update!(used_at: Time.current, rokid_device_id: device_id)
  end
  
  # 清理过期令牌
  def self.cleanup_expired
    where('expires_at < ?', Time.current).delete_all
  end
  
  # 清理已使用的令牌
  def self.cleanup_used
    where.not(used_at: nil).delete_all
  end
  
  private
  
  def generate_token
    self.token ||= SecureRandom.hex(16) # 32字符随机令牌
  end
  
  def set_expiration
    self.expires_at ||= 5.minutes.from_now
  end
  
  # 创建新令牌后自动清理旧令牌
  def cleanup_old_tokens
    BindingToken.cleanup_expired
    BindingToken.cleanup_used
  end
end

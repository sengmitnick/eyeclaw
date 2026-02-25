class CleanupExpiredBindingTokenService < ApplicationService
  def initialize
  end

  def call
    # 清理过期的绑定令牌（包括已过期和已使用的）
    deleted_count = BindingToken.cleanup_expired
    Rails.logger.info "[CleanupExpiredBindingToken] Deleted #{deleted_count} expired tokens"
    
    # 也清理已使用的令牌（无需保留）
    used_count = BindingToken.where.not(used_at: nil).delete_all
    Rails.logger.info "[CleanupExpiredBindingToken] Deleted #{used_count} used tokens"
    
    { deleted: deleted_count, used: used_count }
  end
end

threads_count = ENV.fetch("RAILS_MAX_THREADS", 5)
threads threads_count, threads_count

# Use APP_PORT from environment, fallback to PORT, then default 3000
port ENV.fetch("APP_PORT") { ENV.fetch("PORT", "3000") }

# 环境特定配置
if ENV.fetch("RAILS_ENV", "development") == "production"
  # Production: 使用多 worker 和 preload 以提高性能
  workers ENV.fetch("WEB_CONCURRENCY", 2)
  preload_app!
else
  # Development: 使用单 worker，确保 SSE 实时流式输出
  # 多 worker + preload 会导致 ActionController::Live 缓冲所有数据
  workers 0
end

plugin :tmp_restart

pidfile ENV["PIDFILE"] if ENV["PIDFILE"]

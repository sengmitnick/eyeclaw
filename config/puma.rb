threads_count = ENV.fetch("RAILS_MAX_THREADS", 5)
threads threads_count, threads_count

# Use APP_PORT from environment, fallback to PORT, then default 3000
port ENV.fetch("APP_PORT") { ENV.fetch("PORT", "3000") }

# Standard multi-process configuration for development
# SSE connections are now handled through standard Rails mechanisms
workers ENV.fetch("WEB_CONCURRENCY", 2)

# Preload app for better performance
preload_app!

plugin :tmp_restart

pidfile ENV["PIDFILE"] if ENV["PIDFILE"]

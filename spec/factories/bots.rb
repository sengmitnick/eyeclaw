FactoryBot.define do
  factory :bot do
    name { "Test Bot #{rand(1000)}" }
    description { "A test bot for automated testing" }
    status { "offline" }
    api_key { SecureRandom.hex(32) }
    sdk_token { SecureRandom.hex(32) }
    mcp_url { "https://example.com/mcp/stream/#{SecureRandom.hex(8)}" }
    webhook_url { "https://example.com/webhooks/#{SecureRandom.hex(8)}" }
    config { {} }
    association :user
  end
end

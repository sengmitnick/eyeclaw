FactoryBot.define do
  factory :bot do
    name { "Test Bot #{rand(1000)}" }
    description { "A test bot for automated testing" }
    status { "offline" }
    api_key { SecureRandom.hex(32) }
    sdk_token { SecureRandom.hex(32) }
    webhook_url { "https://example.com/webhooks/#{SecureRandom.hex(8)}" }
    rokid_device_id { nil } # Optional: can be set in tests
    config { {} }
    association :user
  end
end

FactoryBot.define do
  factory :bot_session do

    association :bot
    session_id { "MyString" }
    connected_at { Time.current }
    last_ping_at { Time.current }
    metadata { nil }

  end
end

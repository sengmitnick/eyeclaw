FactoryBot.define do
  factory :binding_token do

    token { "MyString" }
    association :bot
    expires_at { Time.current }
    used_at { Time.current }
    rokid_device_id { "MyString" }

  end
end

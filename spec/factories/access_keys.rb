FactoryBot.define do
  factory :access_key do

    name { "MyString" }
    key { "MyString" }
    description { "MyText" }
    is_active { true }
    last_used_at { Time.current }

  end
end

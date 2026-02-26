FactoryBot.define do
  factory :stream_trace do

    trace_id { "MyString" }
    message_id { "MyString" }
    agent_id { "MyString" }
    bot_id { 1 }
    status { "MyString" }
    events { "MyText" }
    sdk_content { "MyText" }
    sse_content { "MyText" }
    sdk_chunk_count { 1 }
    sse_chunk_count { 1 }
    anomaly { "MyText" }

  end
end

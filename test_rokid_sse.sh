#!/bin/bash

# Rokid SSE Streaming Test
# 验证流式输出是否实时逐块返回

TOKEN="ak_db85551fafbd9cd80d129d36a2155623ad20e843c9455fc264ce3ceaf27f5db1"
MESSAGE_ID="test_$(date +%s)"
AGENT_ID="4"

echo "Testing Rokid SSE streaming..."
echo "Message ID: $MESSAGE_ID"
echo "Agent ID: $AGENT_ID"
echo "---"

curl -N \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"message_id\": \"$MESSAGE_ID\",
    \"agent_id\": \"$AGENT_ID\",
    \"user_id\": \"test_user\",
    \"message\": [
      {
        \"role\": \"user\",
        \"content\": \"请用50个字介绍小龙虾\"
      }
    ]
  }" \
  http://localhost:3000/sse/rokid

echo ""
echo "---"
echo "Test completed"

#!/usr/bin/env node

// Test script for EyeClaw SDK chat functionality
// Usage: node sdk/test_chat.js

import { EyeClawClient } from './src/client.js'

// Simple console logger
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${msg}`)
}

// Check environment variables
const serverUrl = process.env.EYECLAW_SERVER_URL || 'http://localhost:3000'
const sdkToken = process.env.EYECLAW_SDK_TOKEN

if (!sdkToken) {
  console.error('❌ Error: EYECLAW_SDK_TOKEN environment variable is required')
  console.log('\nUsage:')
  console.log('  export EYECLAW_SDK_TOKEN=your_token_here')
  console.log('  node sdk/test_chat.js')
  console.log('\nOptional:')
  console.log('  export EYECLAW_SERVER_URL=http://localhost:3000')
  process.exit(1)
}

// Create client
const config = {
  serverUrl,
  sdkToken,
  reconnectInterval: 5000,
  heartbeatInterval: 30000
}

console.log('\n🤖 EyeClaw SDK Chat Test')
console.log('========================\n')
console.log(`Server: ${serverUrl}`)
console.log(`Token: ${sdkToken.substring(0, 10)}...\n`)

const client = new EyeClawClient(config, logger)

// Connect to server
try {
  await client.connect()
  console.log('\n✅ Connected! Bot is now online and ready to receive messages.')
  console.log('💡 Go to the web dashboard and test the chat functionality.\n')
  console.log('Press Ctrl+C to exit.\n')
} catch (error) {
  console.error(`\n❌ Connection failed: ${error.message}`)
  process.exit(1)
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Disconnecting...')
  client.disconnect()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n\n👋 Disconnecting...')
  client.disconnect()
  process.exit(0)
})

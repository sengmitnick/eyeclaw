#!/usr/bin/env node
/**
 * Test script for @eyeclaw/sdk
 * Tests WebSocket connection to Rails backend
 */

import { EyeClawClient } from './dist/client.js'

// Simple logger implementation
const logger = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  debug: (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args),
}

// Test configuration
const config = {
  enabled: true,
  botId: process.env.BOT_ID || '1',
  sdkToken: process.env.SDK_TOKEN || '',
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
  reconnectInterval: 5000,
  heartbeatInterval: 30000,
}

if (!config.sdkToken) {
  console.error('❌ SDK_TOKEN environment variable is required')
  console.log('Usage: BOT_ID=1 SDK_TOKEN=xxx SERVER_URL=http://localhost:3000 node test.js')
  process.exit(1)
}

console.log('🔧 Test Configuration:')
console.log(`   Bot ID: ${config.botId}`)
console.log(`   Server: ${config.serverUrl}`)
console.log(`   Token: ${config.sdkToken.slice(0, 16)}...`)
console.log('')

// Create client and connect
const client = new EyeClawClient(config, logger)

console.log('🚀 Starting connection test...\n')

client.connect().catch((error) => {
  console.error('Failed to connect:', error)
  process.exit(1)
})

// Test sending logs after 5 seconds
setTimeout(() => {
  console.log('\n📤 Sending test log message...')
  client.sendLog('info', 'Test message from SDK')
  
  console.log('📊 Requesting bot status...')
  client.requestStatus()
}, 5000)

// Keep process alive
setInterval(() => {
  // Keep alive
}, 10000)

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...')
  client.disconnect()
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...')
  client.disconnect()
  process.exit(0)
})

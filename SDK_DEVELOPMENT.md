# EyeClaw SDK Development

## Overview

The `@eyeclaw/sdk` npm package enables OpenClaw instances to connect to the EyeClaw platform via WebSocket (ActionCable).

## Project Structure

```
sdk/
├── src/
│   ├── client.ts          # WebSocket client for EyeClaw connection
│   ├── index.ts           # OpenClaw plugin entry point
│   ├── cli.ts             # CLI entry point
│   └── types.ts           # TypeScript type definitions
├── test.js                # Connection test script
├── package.json           # npm package configuration
├── tsconfig.json          # TypeScript configuration
├── README.md              # SDK documentation
├── LICENSE                # MIT license
└── publish.sh             # npm publish script
```

## Installation

Users install the SDK as an OpenClaw plugin:

```bash
# Install the plugin
openclaw plugins install @eyeclaw/sdk

# Configure
openclaw config set channels.eyeclaw.enabled true
openclaw config set channels.eyeclaw.botId "YOUR_BOT_ID"
openclaw config set channels.eyeclaw.sdkToken "YOUR_SDK_TOKEN"
openclaw config set channels.eyeclaw.serverUrl "https://your-eyeclaw-server.com"
```

## Architecture

### WebSocket Authentication Flow

1. SDK connects to `ws://server/cable?sdk_token=XXX`
2. Rails `ApplicationCable::Connection` authenticates via `sdk_token` query parameter
3. On success, SDK subscribes to `BotChannel`
4. Bot session is created and marked as `online`
5. Bidirectional communication begins

### Rails Backend Components

#### `app/channels/application_cable/connection.rb`
- Supports dual authentication:
  - User sessions (for dashboard WebSocket)
  - SDK tokens (for bot WebSocket)
- Sets `current_user` OR `current_bot` based on authentication method

#### `app/channels/bot_channel.rb`
- Handles SDK client connections
- Creates/manages bot sessions
- Methods:
  - `ping` - Heartbeat
  - `status` - Bot status request
  - `execute_command` - Execute commands on OpenClaw
  - `command_result` - Send command results back
  - `log` - Send log messages

#### `app/channels/dashboard_channel.rb`
- Handles user dashboard connections
- Requires user authentication
- Streams bot activity in real-time

## Development

### Building the SDK

```bash
cd sdk
npm install
npm run build
```

### Testing Connection

```bash
cd sdk
BOT_ID=1 \
SDK_TOKEN=your_sdk_token \
SERVER_URL=http://localhost:3000 \
node test.js
```

Expected output:
```
[INFO] Connecting to EyeClaw: ws://localhost:3000/cable?sdk_token=***
[INFO] WebSocket connected, subscribing to BotChannel...
[INFO] Received welcome message from ActionCable
[INFO] 🎉 Bot connected! Session ID: xxx
[INFO] ✅ Successfully subscribed to BotChannel
```

### Publishing to npm

1. Configure `.env` with your `NPM_TOKEN`:
   ```bash
   NPM_TOKEN=your_npm_token_here
   ```

2. Run the publish script:
   ```bash
   cd sdk
   ./publish.sh
   ```

## Message Protocol

### SDK → Rails

```javascript
// Heartbeat
{ action: 'ping' }

// Status request
{ action: 'status' }

// Send logs
{ action: 'log', level: 'info', message: 'text', timestamp: 'ISO8601' }

// Command result
{ action: 'command_result', command: 'cmd', result: {}, error: null, timestamp: 'ISO8601' }
```

### Rails → SDK

```javascript
// Connection confirmation
{ type: 'connected', bot_id: 1, session_id: 'uuid', message: 'Successfully connected' }

// Heartbeat response
{ type: 'pong', timestamp: 'ISO8601' }

// Status response
{ type: 'status_response', status: 'online', online: true, active_sessions: 1, uptime: 123 }

// Command execution (from dashboard/API)
{ type: 'command_result', session_id: 'uuid', command: 'cmd', params: {} }

// Log broadcast
{ type: 'log', level: 'info', message: 'text', timestamp: 'ISO8601' }
```

## Testing Checklist

- [x] SDK connects to Rails via WebSocket
- [x] SDK authenticates with `sdk_token`
- [x] Bot session is created on connection
- [x] Bot status changes to `online`
- [x] Heartbeat mechanism works
- [x] Log messages are transmitted
- [x] Status requests work
- [x] Bot disconnects cleanly
- [x] Bot status changes to `offline` after disconnect
- [x] All Rails tests pass (37 specs)

## Troubleshooting

### Connection rejected with "unauthorized"

**Cause**: SDK token is invalid or bot doesn't exist.

**Fix**: Check that the SDK token matches the bot's `sdk_token` in the database.

### WebSocket connects but doesn't subscribe

**Cause**: BotChannel subscription fails.

**Fix**: Check Rails logs for channel subscription errors. Ensure `current_bot` is set in the connection.

### Bot status not updating

**Cause**: Bot session not being created/destroyed properly.

**Fix**: Check `Bot#connect!` and `Bot#disconnect!` methods in `app/models/bot.rb`.

## Future Enhancements

- [ ] Add MCP command execution from dashboard
- [ ] Implement file transfer over WebSocket
- [ ] Add authentication token rotation
- [ ] Support multiple simultaneous sessions per bot
- [ ] Add connection analytics and monitoring

---

**Last Updated**: 2026-02-23  
**SDK Version**: 0.1.0  
**Rails Version**: 7.2

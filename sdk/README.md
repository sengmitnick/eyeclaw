# @eyeclaw/eyeclaw

EyeClaw channel plugin for [OpenClaw](https://github.com/openclaw/openclaw) - Connect your local OpenClaw instance to the EyeClaw platform.

## Installation

```bash
openclaw plugins install @eyeclaw/eyeclaw
```

### Windows Troubleshooting

If `openclaw plugins install` fails with `spawn npm ENOENT`, install manually:

```bash
# 1. Download the package
curl -O https://registry.npmjs.org/@eyeclaw/eyeclaw/-/eyeclaw-1.0.0.tgz

# 2. Install from local file
openclaw plugins install ./eyeclaw-1.0.0.tgz
```

## Configuration

### 1. Create a Bot on EyeClaw

1. Sign up at [https://eyeclaw.io](https://eyeclaw.io)
2. Create a new bot in your dashboard
3. Copy the Bot ID and SDK Token

### 2. Configure OpenClaw

```bash
openclaw config set channels.eyeclaw.enabled true
openclaw config set channels.eyeclaw.botId "your-bot-id"
openclaw config set channels.eyeclaw.sdkToken "your-sdk-token"
openclaw config set channels.eyeclaw.serverUrl "https://eyeclaw.io"
```

### 3. Start OpenClaw

```bash
openclaw start
```

You should see the connection message:

```
✅ Successfully subscribed to BotChannel
🎉 Bot connected! Session ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## Configuration Options

```yaml
channels:
  eyeclaw:
    enabled: true
    botId: "1"
    sdkToken: "your-sdk-token-here"
    serverUrl: "https://eyeclaw.io"  # or self-hosted URL
    reconnectInterval: 5000  # milliseconds (default: 5000)
    heartbeatInterval: 30000  # milliseconds (default: 30000)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable/disable the plugin |
| `botId` | string | - | Bot ID from EyeClaw dashboard |
| `sdkToken` | string | - | SDK Token for authentication |
| `serverUrl` | string | `https://eyeclaw.io` | EyeClaw server URL |
| `reconnectInterval` | number | `5000` | Reconnect interval in ms |
| `heartbeatInterval` | number | `30000` | Heartbeat interval in ms |

## Features

- **WebSocket Connection**: Real-time bidirectional communication with EyeClaw platform
- **Auto-Reconnect**: Automatically reconnects on connection loss
- **Heartbeat**: Keeps connection alive with periodic ping/pong
- **Real-time Monitoring**: View bot status, logs, and sessions in EyeClaw dashboard
- **MCP Integration**: Expose your bot as MCP plugin for platforms like Coze, Claude Desktop
- **Session Management**: Track connection sessions with uptime and activity logs

## MCP Plugin Integration

Your bot automatically provides an MCP plugin URL that can be used with AI platforms:

```
https://eyeclaw.io/mcp/stream/your-bot-id?api_key=your-api-key
```

### Supported Platforms

- **Coze**: Add as custom MCP plugin
- **Claude Desktop**: Add to `claude_desktop_config.json`
- **Other MCP-compatible platforms**: Use the stream URL

## Upgrade

```bash
openclaw plugins update eyeclaw
```

## Uninstall

```bash
openclaw plugins uninstall eyeclaw
```

## Troubleshooting

### Bot cannot connect

1. Check your internet connection
2. Verify `botId` and `sdkToken` are correct
3. Ensure `serverUrl` is accessible
4. Check OpenClaw logs: `openclaw logs`

### Connection drops frequently

1. Check firewall settings
2. Verify network stability
3. Try increasing `heartbeatInterval`:

```bash
openclaw config set channels.eyeclaw.heartbeatInterval 60000
```

### "Unauthorized" error

Your SDK token may be invalid or expired. Regenerate it in the EyeClaw dashboard:

1. Go to your bot settings
2. Click "Regenerate SDK Token"
3. Update OpenClaw config with the new token

## Architecture

```
┌─────────────────┐         WebSocket         ┌──────────────────┐
│  Local OpenClaw │◄────────────────────────►│ EyeClaw Platform │
│    Instance     │    ActionCable/BotChannel  │   (Rails)        │
└─────────────────┘                            └──────────────────┘
        │                                               │
        │                                               │
        ▼                                               ▼
  Execute commands                            Real-time dashboard
  Process requests                            Status monitoring
  Run tools                                   Activity logs
```

### How it Works

1. **Plugin Initialization**: When OpenClaw starts, the plugin connects to EyeClaw via WebSocket
2. **Authentication**: Uses SDK Token to authenticate with BotChannel
3. **Session Creation**: Server creates a session and assigns a session ID
4. **Heartbeat**: Plugin sends periodic pings to keep connection alive
5. **Event Forwarding**: OpenClaw events (messages, tool execution, errors) are sent to EyeClaw
6. **Dashboard Updates**: EyeClaw dashboard shows real-time status and logs

## Development

### Build from Source

```bash
cd sdk
npm install
npm run build
```

### Link Locally

```bash
npm link
openclaw plugins install /path/to/eyeclaw/sdk
```

### Run TypeScript in Watch Mode

```bash
npm run watch
```

## API Reference

### EyeClawClient

```typescript
import { EyeClawClient } from '@eyeclaw/eyeclaw'

const client = new EyeClawClient(config, logger)

// Connect to EyeClaw
await client.connect()

// Send log message
client.sendLog('info', 'Hello from OpenClaw')

// Send command result
client.sendCommandResult('execute_tool', { result: 'success' })

// Request bot status
client.requestStatus()

// Disconnect
client.disconnect()
```

## Support

- **Documentation**: [https://eyeclaw.io/docs](https://eyeclaw.io/docs)
- **Issues**: [https://github.com/eyeclaw/eyeclaw/issues](https://github.com/eyeclaw/eyeclaw/issues)
- **Discord**: [https://discord.gg/eyeclaw](https://discord.gg/eyeclaw)

## 💬 Chat Functionality

The EyeClaw SDK includes built-in chat functionality that allows you to interact with your bot through the web dashboard.

### Testing Chat

1. Start your bot with the EyeClaw plugin installed
2. Go to your bot's detail page on EyeClaw Dashboard
3. Click **"Test Chat"** button
4. Send messages - the bot will respond with smart replies
5. Use quick test buttons:
   - **Ping** - Test bot connectivity
   - **Status** - Get bot status (online, sessions, uptime)
   - **Echo** - Echo back a test message
   - **Help** - Show available commands

### Supported Commands

The SDK automatically handles these commands from the web dashboard:

- **`chat`** - Receive and respond to chat messages
  - Params: `{ message: string }`
  - The bot uses pattern matching to generate smart responses
  - Supports greetings, questions, thanks, farewells in Chinese and English

- **`ping`** - Test bot connectivity
  - Response: "🏓 Pong! Bot is responding."

- **`status`** - Get current bot status
  - Returns: online status, active sessions, total sessions, uptime

- **`echo`** - Echo back a message
  - Params: `{ message: string }`
  - Response: Echoes the message back

- **`help`** - Show available commands
  - Response: Lists all available commands and their usage

### Customizing Bot Responses

You can customize the bot's chat responses by modifying `generateBotReply()` in `sdk/src/client.ts`:

```typescript
private generateBotReply(userMessage: string): string {
  const lowerMessage = userMessage.toLowerCase()

  // Add your custom patterns
  if (lowerMessage.includes('weather')) {
    return '🌤️ The weather is great today!'
  }

  if (lowerMessage.includes('time')) {
    return `🕐 Current time: ${new Date().toLocaleTimeString()}`
  }

  // Default response
  return `💬 You said: "${userMessage}"`
}
```

### Integrating AI/LLM Services

For production use, integrate your preferred AI service:

```typescript
import OpenAI from 'openai'

private async generateBotReply(userMessage: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  
  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: userMessage }
    ]
  })
  
  return completion.choices[0].message.content || 'Sorry, I could not generate a response.'
}
```

### Message Flow

```
User (Web Dashboard)
     │
     ▼
DashboardChannel ──execute_command──► BotChannel
     │                                      │
     │                                      ▼
     │                              SDK receives command
     │                                      │
     │                                      ▼
     │                              handleExecuteCommand()
     │                                      │
     │                                      ▼
     │                              generateBotReply()
     │                                      │
     │                                      ▼
     │◄───────── sendLog() ──────────sendLog('info', reply)
     │
     ▼
Chat Controller displays message
```

## License

MIT © EyeClaw Team

## Related Projects

- [OpenClaw](https://github.com/openclaw/openclaw) - The AI assistant framework
- [clawdbot-feishu](https://github.com/m1heng/clawdbot-feishu) - Feishu/Lark channel plugin (inspiration for this plugin)

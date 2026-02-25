# Rokid Bot Platform

A secure and robust platform for managing AI-powered Bots that integrate with Rokid AR glasses, built on Rails 7 with real-time communication capabilities.

## Overview

This platform enables users to create and manage AI Bots that can be securely bound to Rokid AR glasses devices. The system provides:

- **Secure Device Binding**: One-time temporary tokens prevent enumeration attacks
- **Real-time Communication**: SSE (Server-Sent Events) streaming for instant responses
- **Offline Detection**: Fast-fail mechanism when Bot is offline (< 0.1s response)
- **User Management**: Built-in authentication system for Bot owners
- **Admin Dashboard**: Complete backend management interface

## Key Features

### 1. Secure Binding Flow

- **One-time Tokens**: 32-character random hex tokens with 5-minute expiration
- **QR Code Authentication**: Secure device binding via QR code scanning
- **Anti-enumeration**: Prevents attackers from guessing Bot IDs
- **Documentation**: See [docs/SECURE_BINDING_FLOW.md](docs/SECURE_BINDING_FLOW.md)

### 2. Bot Offline Detection

- **Immediate Detection**: Checks Bot online status via BotSession (< 0.1s)
- **Timeout Handling**: 60-second idle timeout with clear error messages
- **Heart-beat Monitoring**: 5-minute activity threshold
- **Documentation**: See [docs/BOT_OFFLINE_DETECTION.md](docs/BOT_OFFLINE_DETECTION.md)

### 3. SSE Streaming

- **Dual Implementation**: Rack hijacking + ActionController::Live
- **Error Handling**: No duplicate error messages (fixed)
- **ActionCable Integration**: Real-time Bot command broadcasting
- **Documentation**: See [docs/BUGFIX_DUPLICATE_ERROR_MESSAGE.md](docs/BUGFIX_DUPLICATE_ERROR_MESSAGE.md)

## Architecture

```
Rokid Glasses <--SSE--> Rails Server <--ActionCable--> Bot Client
      |                       |                            |
   agent_id              Web Interface              OpenClaw API
      |                       |                            |
   QR Scan  ----------> BindingToken  <------------ Bot Process
                             |
                        BotSession (online status)
```

### Core Models

- **Bot**: AI Bot configuration and settings
- **BotSession**: Tracks Bot online/offline status via heartbeat
- **BindingToken**: Temporary one-time tokens for secure device binding
- **User**: Bot owners with authentication
- **AccessKey**: API authentication for Rokid glasses

## Documentation

### Security & Features
- [Secure Binding Flow](docs/SECURE_BINDING_FLOW.md) - How device binding works
- [Bot Offline Detection](docs/BOT_OFFLINE_DETECTION.md) - Online status monitoring
- [Duplicate Error Fix](docs/BUGFIX_DUPLICATE_ERROR_MESSAGE.md) - SSE error handling

### Development
- [Project Documentation](docs/project.md) - Deployment and architecture details

## Installation

Install dependencies:

* postgresql

    ```bash
    $ brew install postgresql
    ```

    Ensure you have already initialized a user with username: `postgres` and password: `postgres`( e.g. using `$ createuser -d postgres` command creating one )

* rails 7

    Using `rbenv`, update `ruby` up to 3.x, and install `rails 7.x`

    ```bash
    $ ruby -v ( output should be 3.x )

    $ gem install rails

    $ rails -v ( output should be rails 7.x )
    ```

* npm

    Make sure you have Node.js and npm installed

    ```bash
    $ npm --version ( output should be 8.x or higher )
    ```

Install dependencies, setup db:
```bash
$ ./bin/setup
```

Start it:
```
$ bin/dev
```

## Admin dashboard info

This template already have admin backend for website manager, do not write business logic here.

Access url: /admin

Default superuser: admin

Default password: admin

## Tech Stack

* **Backend**: Ruby on Rails 7.2 with PostgreSQL
* **Frontend**: Tailwind CSS 3 with custom design system
* **Real-time**: 
  - Server-Sent Events (SSE) for Rokid glasses streaming
  - ActionCable for Bot command broadcasting
  - Hotwire Turbo (Drive + Streams, no Frames)
* **JavaScript**: Stimulus controllers (TypeScript)
* **Authentication**: Figaro for environment variables, custom auth system
* **Storage**: Active Storage for file uploads
* **Pagination**: Kaminari
* **Testing**: RSpec with request specs
* **Server**: Puma web server

## API Endpoints

### Rokid SSE Endpoint

```bash
POST /sse/rokid
Authorization: Bearer {access_key}
Content-Type: application/json

{
  "message_id": "unique_id",
  "agent_id": "rokid_device_id",
  "user_id": "user_identifier",
  "message": [
    {"role": "user", "type": "text", "text": "Hello"}
  ],
  "metadata": {}
}
```

**Response**: SSE stream with `message` and `done` events

### Testing with curl

```bash
# Generate test token
rails dev:token[test@example.com]

# Use the token
curl -H 'Authorization: Bearer {token}' \
     -H 'Content-Type: application/json' \
     -d '{"message_id":"123","agent_id":"device1","message":[{"role":"user","type":"text","text":"你好"}]}' \
     http://localhost:3000/sse/rokid
```
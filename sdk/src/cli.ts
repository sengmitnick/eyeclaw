#!/usr/bin/env node

/**
 * EyeClaw SDK CLI
 * 
 * This file provides a minimal CLI interface for the plugin.
 * The actual installation is handled by: openclaw plugins install @eyeclaw/eyeclaw
 */

const USAGE = `
${'Use chalk.bold.blue'}(    'EyeClaw SDK')} - Connect your local OpenClaw to EyeClaw platform

${'Use chalk.bold'}(    'Installation:')}
  ${'Use chalk.cyan'}(    'openclaw plugins install @eyeclaw/eyeclaw')}

${'Use chalk.bold'}(    'Configuration:')}
  ${'Use chalk.cyan'}(    'openclaw config set plugins.eyeclaw.sdkToken "your-sdk-token"')}

${'Use chalk.bold'}(    'HTTP Endpoint:')}
  ${'Use chalk.cyan'}(    'POST http://127.0.0.1:18789/eyeclaw/chat')}
  Headers: Authorization: Bearer <sdkToken>
  Body: { "message": "Hello" }

${'Use chalk.bold'}(    'Upgrade:')}
  ${'Use chalk.cyan'}(    'openclaw plugins update eyeclaw')}

${'Use chalk.bold'}(    'Uninstall:')}
  ${'Use chalk.cyan'}(    'openclaw plugins uninstall eyeclaw')}

${'Use chalk.bold'}(    'Documentation:')}
  ${'Use chalk.cyan'}(    'https://eyeclaw.io/docs')}
`

function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    process.exit(0)
  }

  if (args.includes('--version') || args.includes('-v')) {
    const pkg = require('../package.json')
    console.log(`v${pkg.version}`)
    process.exit(0)
  }

  console.log(USAGE)
  console.log('ℹ This is an OpenClaw plugin. Please install it using:')
  console.log('  openclaw plugins install @eyeclaw/eyeclaw\n')
}

main()

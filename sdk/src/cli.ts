#!/usr/bin/env node
import chalk from 'chalk'

/**
 * EyeClaw SDK CLI
 * 
 * This file provides a minimal CLI interface for the plugin.
 * The actual installation is handled by: openclaw plugins install @eyeclaw/sdk
 */

const USAGE = `
${chalk.bold.blue('EyeClaw SDK')} - Connect your local OpenClaw to EyeClaw platform

${chalk.bold('Installation:')}
  ${chalk.cyan('openclaw plugins install @eyeclaw/sdk')}

${chalk.bold('Configuration:')}
  ${chalk.cyan('openclaw config set channels.eyeclaw.enabled true')}
  ${chalk.cyan('openclaw config set channels.eyeclaw.botId "your-bot-id"')}
  ${chalk.cyan('openclaw config set channels.eyeclaw.sdkToken "your-sdk-token"')}
  ${chalk.cyan('openclaw config set channels.eyeclaw.serverUrl "https://eyeclaw.io"')}

${chalk.bold('Upgrade:')}
  ${chalk.cyan('openclaw plugins update eyeclaw')}

${chalk.bold('Uninstall:')}
  ${chalk.cyan('openclaw plugins uninstall eyeclaw')}

${chalk.bold('Documentation:')}
  ${chalk.cyan('https://eyeclaw.io/docs')}

${chalk.bold('Support:')}
  ${chalk.cyan('https://github.com/eyeclaw/eyeclaw/issues')}
`

function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    process.exit(0)
  }

  if (args.includes('--version') || args.includes('-v')) {
    // Read version from package.json
    const pkg = require('../package.json')
    console.log(`v${pkg.version}`)
    process.exit(0)
  }

  // Default: show usage
  console.log(USAGE)
  console.log(chalk.yellow('ℹ This is an OpenClaw plugin. Please install it using:'))
  console.log(chalk.cyan('  openclaw plugins install @eyeclaw/eyeclaw\n'))
}

main()

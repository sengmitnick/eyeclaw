import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk'
import { eyeclawPlugin } from './src/channel.js'

/**
 * EyeClaw SDK - OpenClaw Channel Plugin
 * 
 * Connects local OpenClaw instance to EyeClaw platform via WebSocket.
 */
const plugin = {
  id: 'eyeclaw',
  name: 'EyeClaw',
  description: 'EyeClaw platform channel plugin',
  configSchema: emptyPluginConfigSchema(),
  
  register(api: OpenClawPluginApi) {
    // Register EyeClaw as a channel plugin
    api.registerChannel({ plugin: eyeclawPlugin })
  },
}

export default plugin

// Re-export for direct usage
export { EyeClawClient } from './src/client.js'
export * from './src/types.js'
export { eyeclawPlugin } from './src/channel.js'

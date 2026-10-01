import { createPlatformDependencies } from './platform.mjs'
import { createAgentDependencies } from './agent.mjs'
import { createChatgptDependencies } from './chatgpt.mjs'
import { createDesktopDependencies } from './desktop.mjs'
import { createTransportDependencies } from './transport.mjs'

export function createDesktopBaseDependencies() {
  return {
    ...createPlatformDependencies(),
    ...createAgentDependencies(),
    ...createChatgptDependencies(),
    ...createDesktopDependencies(),
    ...createTransportDependencies(),
  }
}

import { createAgentCollections } from './agent.mjs'
import { createChatGPTCollections } from './chatgpt.mjs'
import { createWindowCollections } from './window.mjs'

export function createDesktopCollections(ProjectWindowRegistry) {
  return {
    ...createChatGPTCollections(),
    ...createAgentCollections(),
    ...createWindowCollections(ProjectWindowRegistry),
  }
}

import { advanceChatGPTConversationTransportGeneration } from './entry.mjs'
import { createChatGPTViewNavigation } from './navigation.mjs'
import { createChatGPTSupervisorViewLifecycle } from './supervisor.mjs'
import { createChatGPTWorkerViewLifecycle } from './worker.mjs'
export { createOwnedChatGPTConversationReload } from './reload.mjs'
export { createChatGPTViewCleanup } from './cleanup.mjs'
export { createChatGPTViewState } from './state.mjs'
export { createChatGPTViewOwnership } from './ownership.mjs'

export function createChatGPTViewOperations(options) {
  const navigation = createChatGPTViewNavigation(options)
  const lifecycle = {
    ...options,
    loadOwnedChatGPTURL: navigation.loadOwnedChatGPTURL,
    advanceChatGPTConversationTransportGeneration: (entry) => advanceChatGPTConversationTransportGeneration(entry, options),
  }
  return {
    ...navigation,
    ...createChatGPTSupervisorViewLifecycle(lifecycle),
    ...createChatGPTWorkerViewLifecycle(lifecycle),
  }
}

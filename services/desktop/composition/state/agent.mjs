export function createAgentCollections() {
  return {
    chatAgentWorkerStates: new Map(),
    // One Supervisor state per slot; the durable queue owns task state.
    chatSupervisorStates: new Map(),
    activeChatTranslatorSlots: new Set(),
  }
}

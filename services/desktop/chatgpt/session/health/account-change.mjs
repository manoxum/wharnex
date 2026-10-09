// Process-wide notice that the ChatGPT account behind the shared partition
// may have changed: a completed login, an imported or a cleared session.
// Account-scoped state (the upload limit) subscribes; nothing here reads
// credentials or identifies the account.
const listeners = new Set()

export function onChatGPTAccountChanged(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyChatGPTAccountChanged(reason) {
  for (const listener of listeners) {
    try { listener(String(reason || 'account-changed')) } catch (error) {
      console.warn(`[chatgpt-account] change listener failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

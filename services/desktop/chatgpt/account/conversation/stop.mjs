import { chatGPTStopConversationScript } from '../chatgpt-account.mjs'

export function createAccountStop(context) {
  const {
    sanitizeChatCacheKey,
    chatgptViews,
    serializeChatGPTAccountOperation,
    reconcileChatGPTThrottle,
    runChatGPTAccountAction,
    commitChatGPTAccountControl,
  } = context

  async function stopChatGPTConversation(cacheKey) {
    const key = sanitizeChatCacheKey(cacheKey)
    const entry = chatgptViews.get(key)
    if (!entry) return { ok: true, state: 'view-not-live' }
    return serializeChatGPTAccountOperation(async () => {
      entry.accountOperationActive = true
      reconcileChatGPTThrottle(key, entry)
      try {
        return await runChatGPTAccountAction('stop-conversation', { key }, () => commitChatGPTAccountControl(key, entry, 'stop', chatGPTStopConversationScript()))
      } finally {
        entry.accountOperationActive = false
        reconcileChatGPTThrottle(key, entry)
      }
    })
  }

  return { stopChatGPTConversation }
}

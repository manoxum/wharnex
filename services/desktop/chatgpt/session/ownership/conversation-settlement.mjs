export function createChatGPTConversationSettlement({
  canonicalChatGPTConversationURL, requireOwnedChatGPTEntry,
  settleChatGPTAffinityAfterSubmit, wait,
}) {
  async function waitForConcreteChatGPTConversation(wc, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs
    let candidate = ''
    let stableSince = 0
    while (Date.now() < deadline) {
      if (!wc || wc.isDestroyed()) break
      const current = canonicalChatGPTConversationURL(wc.getURL())
      if (current !== candidate) {
        candidate = current
        stableSince = current ? Date.now() : 0
      }
      if (candidate && !wc.isLoading() && Date.now() - stableSince >= 600) return candidate
      await wait(100)
    }
    return ''
  }

  async function waitForSubmittedChatGPTConversation(cacheKey, entry, fallback = '') {
    const { wc } = requireOwnedChatGPTEntry(cacheKey, entry)
    const stableURL = await waitForConcreteChatGPTConversation(wc, 30_000)
    if (stableURL) settleChatGPTAffinityAfterSubmit(cacheKey, entry, stableURL)
    return stableURL || canonicalChatGPTConversationURL(fallback)
  }

  return { waitForConcreteChatGPTConversation, waitForSubmittedChatGPTConversation }
}

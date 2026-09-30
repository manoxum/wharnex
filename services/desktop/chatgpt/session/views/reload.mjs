export function createOwnedChatGPTConversationReload({
  sanitizeChatCacheKey, requireOwnedChatGPTEntry,
  canonicalChatGPTConversationURL, sameConversationURL,
  loadOwnedChatGPTURL, isTrustedChatGPTOrigin, homeURL,
}) {
  async function reloadOwnedChatGPTConversation(cacheKey, entry, reason = 'reload') {
    const key = sanitizeChatCacheKey(cacheKey)
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    const linkedConversation = canonicalChatGPTConversationURL(entry.affinity.boundURL || '')
    if (linkedConversation && !sameConversationURL(wc.getURL(), linkedConversation)) {
      await loadOwnedChatGPTURL(key, entry, linkedConversation, `${reason}-linked`)
      return { restoredLinkedConversation: true, conversationUrl: linkedConversation }
    }
    if (isTrustedChatGPTOrigin(wc.getURL())) {
      wc.reload()
      return { restoredLinkedConversation: false, conversationUrl: canonicalChatGPTConversationURL(wc.getURL()) }
    }
    const fallbackURL = linkedConversation || homeURL
    await loadOwnedChatGPTURL(key, entry, fallbackURL, `${reason}-fallback`)
    return { restoredLinkedConversation: Boolean(linkedConversation), conversationUrl: canonicalChatGPTConversationURL(fallbackURL) }
  }

  return { reloadOwnedChatGPTConversation }
}

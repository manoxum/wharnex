import { normalizeWHXTitle } from '../naming.mjs'

export function createAccountTitle(context) {
  const {
    sanitizeChatCacheKey,
    ensureChatGPTView,
    requireOwnedChatGPTEntry,
    requireTrustedChatGPTURL,
    sameConversationURL,
    loadOwnedChatGPTURL,
    waitForChatGPTSurfaceReady,
  } = context

  async function suggestChatGPTConversationTitle(cacheKey, expectedURL = '', entryOverride = undefined) {
    const key = sanitizeChatCacheKey(cacheKey)
    const entry = entryOverride || ensureChatGPTView(key).entry
    requireOwnedChatGPTEntry(key, entry)
    if (expectedURL) {
      const target = requireTrustedChatGPTURL(expectedURL)
      if (!sameConversationURL(entry.view.webContents.getURL(), target)) await loadOwnedChatGPTURL(key, entry, target, 'read-conversation-title')
      await waitForChatGPTSurfaceReady(key, entry)
    }
    const raw = String(entry.view.webContents.getTitle() || '').replace(/\s*[|·-]\s*ChatGPT\s*$/i, '').trim()
    const generic = !raw || /^(chatgpt|new chat|novo chat)$/i.test(raw)
    return { ok: !generic, state: generic ? 'title-not-ready' : 'suggested', title: generic ? '' : normalizeWHXTitle(raw) }
  }

  return { suggestChatGPTConversationTitle }
}

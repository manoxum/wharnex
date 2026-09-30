export function createChatGPTHTTPHealth({
  chatGPTExpiredArtifactConversations, EXPIRED_ARTIFACT_TTL_MS,
  chatGPTEntryForWebContentsID, isChatGPTConversationTransportURL,
  expectedChatGPTBundles, setChatGPTHumanAction, clearChatGPTHumanAction,
  noteChatGPTRecoveryFault, getRateLimitUntil,
}) {
  function chatGPTInterpreterDownloadConversation(value) {
    try {
      const url = new URL(String(value || ''))
      if (url.protocol !== 'https:') return ''
      if (url.hostname !== 'chatgpt.com' && !url.hostname.endsWith('.chatgpt.com')) return ''
      return String(url.pathname.match(/^\/backend-api\/conversation\/([A-Za-z0-9-]{1,128})\/interpreter\/download$/)?.[1] || '')
    } catch { return '' }
  }

  function noteChatGPTExpiredArtifact(conversationID, now = Date.now()) {
    if (!conversationID) return false
    chatGPTExpiredArtifactConversations.set(conversationID, now)
    for (const [id, at] of [...chatGPTExpiredArtifactConversations]) {
      if (now - at > EXPIRED_ARTIFACT_TTL_MS) chatGPTExpiredArtifactConversations.delete(id)
    }
    return true
  }

  function chatGPTArtifactExpiredSince(conversationID, since) {
    const at = Number(chatGPTExpiredArtifactConversations.get(String(conversationID || '')) || 0)
    return at > 0 && at >= Number(since || 0)
  }

  function noteChatGPTHTTPStatus(details) {
    const match = chatGPTEntryForWebContentsID(details?.webContentsId)
    if (!match) return false
    const [key, entry] = match
    const status = Number(details?.statusCode || 0)
    const conversationTransport = isChatGPTConversationTransportURL(details?.url)
    // An HTTP 429 is recorded by the [chatgpt-http] log and nothing more. Every
    // open ChatGPT page makes its own background calls, and ChatGPT refuses some
    // of them (the sidebar conversation list above all) while the account keeps
    // submitting normally: 48 such refusals suspended every Worker 19 times in
    // one evening with no limit ever shown. Only the limit control ChatGPT
    // renders in its surface is rate-limit evidence (noteChatGPTRateLimitGate).
    if (status === 429) return false
    // A generated file ChatGPT no longer serves. Recorded per conversation so the
    // task that owns it stops clicking a dead card and asks for the file again.
    if (status === 404) {
      const expiredConversation = chatGPTInterpreterDownloadConversation(details?.url)
      if (expiredConversation) {
        noteChatGPTExpiredArtifact(expiredConversation)
        return true
      }
    }
    if (!conversationTransport) return false
    const expected = expectedChatGPTBundles.get(key)
    if (!expected) return false
    if (status === 401) return setChatGPTHumanAction(key, 'authentication', 'HTTP 401', 'http')
    if (status === 403) return setChatGPTHumanAction(key, 'access', 'HTTP 403', 'http')
    if (status >= 500 && status <= 599) {
      noteChatGPTRecoveryFault(expected.recovery, `ChatGPT HTTP ${status}`, Date.now())
      return true
    }
    if (status > 0 && status < 400) {
      if (Date.now() >= getRateLimitUntil()) expected.backoffUntil = 0
      if (entry.humanAction?.source === 'http' || entry.humanAction?.kind === 'transport') clearChatGPTHumanAction(key, `HTTP ${status}`)
    }
    return false
  }
  return { chatGPTInterpreterDownloadConversation, noteChatGPTExpiredArtifact, chatGPTArtifactExpiredSince, noteChatGPTHTTPStatus }
}

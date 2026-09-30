export function createChatGPTNetworkActivity({
  chatgptViews, chatGPTWorkerEntries, expectedChatGPTBundles,
  isChatGPTConversationTransportURL, recordChatGPTConversationTransport,
  noteChatGPTRecoveryProgress, isRecoverableChatGPTNetworkError,
  noteChatGPTRecoveryFault,
}) {
  function chatGPTEntryForWebContentsID(webContentsId) {
    if (webContentsId == null) return undefined
    const supervisor = [...chatgptViews.entries()].find(([, candidate]) => candidate.view.webContents.id === webContentsId)
    if (supervisor) return supervisor
    const worker = chatGPTWorkerEntries.find((candidate) => candidate.view.webContents.id === webContentsId && candidate.ownerKey)
    return worker ? [worker.ownerKey, worker] : undefined
  }

  function noteChatGPTNetworkActivity(details, phase = 'network') {
    const match = chatGPTEntryForWebContentsID(details?.webContentsId)
    if (!match) return
    const [key, entry] = match
    const now = Date.now()
    entry.lastNetworkActivity = now
    const conversationTransport = isChatGPTConversationTransportURL(details?.url)
    if (conversationTransport) entry.lastConversationActivity = now
    const requestKey = String(details?.id ?? '')
    if (conversationTransport && requestKey) {
      recordChatGPTConversationTransport(entry.conversationRequests, requestKey, entry.conversationTransportGeneration, phase, now)
      if (phase === 'before') entry.staleConversationRequestIds.clear()
      else if (phase === 'completed' || phase === 'error') entry.staleConversationRequestIds.delete(requestKey)
    }
    const expected = expectedChatGPTBundles.get(key)
    if (expected?.recovery && conversationTransport) {
      noteChatGPTRecoveryProgress(expected.recovery, `${phase}:${requestKey}:${details?.method || ''}`, now)
    }
  }

  function noteChatGPTNetworkFailure(details) {
    const match = chatGPTEntryForWebContentsID(details?.webContentsId)
    if (!match) return false
    const conversationTransport = isChatGPTConversationTransportURL(details?.url)
    if (!isRecoverableChatGPTNetworkError(details?.error, { conversationTransport })) return false
    const [key] = match
    const expected = expectedChatGPTBundles.get(key)
    if (!expected?.recovery) return false
    const relevant = details?.resourceType === 'mainFrame' || conversationTransport
    if (!relevant) return false
    noteChatGPTRecoveryFault(expected.recovery, String(details?.error || 'ChatGPT network transport failed'), Date.now())
    console.warn(`[chatgpt-recovery] network-fault key=${key} request=${expected.requestId} error=${String(details?.error || 'unknown')}`)
    return true
  }

  return { chatGPTEntryForWebContentsID, noteChatGPTNetworkActivity, noteChatGPTNetworkFailure }
}

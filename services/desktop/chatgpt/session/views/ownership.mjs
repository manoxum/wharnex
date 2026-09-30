export function createChatGPTViewOwnership({
  sanitizeChatCacheKey, chatgptViews, chatGPTWorkerEntries,
  supervisorBindingHeld, sendToChatGPTKey, cancelExternalAuthentication,
  preparedChatGPTDrafts, retryableChatGPTPrompts, pendingChatGPTComments,
  flushingChatGPTComments, chatGPTActivityFingerprints,
  expectedChatGPTBundles, chatGPTTransportTails, manualChatGPTTransport,
  windowStateForEntry,
}) {
  function requireOwnedChatGPTEntry(cacheKey, entry) {
    const key = sanitizeChatCacheKey(cacheKey)
    const workerOwnsKey = entry?.role === 'worker' && entry.ownerKey === key && chatGPTWorkerEntries.includes(entry)
    const supervisorOwnsKey = entry?.role !== 'worker' && entry?.ownerKey === key && chatgptViews.get(key) === entry
    if (!workerOwnsKey && !supervisorOwnsKey) throw new Error('ChatGPT view ownership mismatch')
    return { key, entry, wc: entry.view.webContents }
  }

  function releaseChatGPTView(cacheKey, ownerState) {
    const key = sanitizeChatCacheKey(cacheKey)
    const entry = chatgptViews.get(key)
    if (!entry) return false
    if (ownerState && entry.ownerWindowId !== ownerState.id) throw new Error('ChatGPT view belongs to another Wharnex window')
    if (supervisorBindingHeld(key, entry)) return false
    if (entry.humanAction?.active) sendToChatGPTKey(key, 'wharness:chatgpt:human-action', { cacheKey: key, active: false, requestId: entry.humanAction.requestId || '', clearedAt: new Date().toISOString(), reason: 'surface released' })
    cancelExternalAuthentication(key)
    clearTimeout(entry.authProbeTimer)
    clearTimeout(entry.affinitySettleTimer)
    chatgptViews.delete(key)
    preparedChatGPTDrafts.delete(key)
    retryableChatGPTPrompts.delete(key)
    pendingChatGPTComments.delete(key)
    flushingChatGPTComments.delete(key)
    chatGPTActivityFingerprints.delete(key)
    expectedChatGPTBundles.delete(key)
    chatGPTTransportTails.delete(key)
    manualChatGPTTransport.release(key)
    const state = windowStateForEntry(entry)
    if (state?.activeChatGPTKey === key) {
      state.activeChatGPTKey = ''
      state.chatgptVisible = false
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    console.log(`[chatgpt-instance] released key=${key} window=${entry.ownerWindowId}`)
    return true
  }

  return { requireOwnedChatGPTEntry, releaseChatGPTView }
}

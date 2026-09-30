export function createChatGPTAffinityRuntime({
  requireTrustedChatGPTURL, observeChatGPTAffinity, canonicalChatGPTConversationURL,
  syncChatGPTAffinity, homeURL, sanitizeDiagnosticURL, proposeChatGPTAffinity,
  publishChatGPTState, settleChatGPTAffinity, isChatGPTAffinityAwaitingSettlement,
  chatGPTKeyForEntry, waitForConcreteChatGPTConversation,
}) {
  function isChatGPTNewChatSurfaceURL(value) {
    try {
      const trusted = requireTrustedChatGPTURL(value)
      const pathname = new URL(trusted).pathname
      return pathname === '/' || pathname === ''
    } catch { return false }
  }

  function observeChatGPTAffinityURL(cacheKey, entry, value) {
    const observed = observeChatGPTAffinity(entry.affinity, {
      home: isChatGPTNewChatSurfaceURL(value),
      conversationUrl: canonicalChatGPTConversationURL(value),
    })
    if (observed) console.log(`[chatgpt-affinity] observed key=${cacheKey} url=${sanitizeDiagnosticURL(observed)}`)
    return observed
  }

  function syncChatGPTAffinityURL(cacheKey, entry, linkedURL = '') {
    const linkedConversation = canonicalChatGPTConversationURL(linkedURL)
    const currentURL = entry.view.webContents.getURL()
    syncChatGPTAffinity(entry.affinity, linkedConversation, !linkedConversation && isChatGPTNewChatSurfaceURL(currentURL))
    console.log(`[chatgpt-affinity] sync key=${cacheKey} phase=${entry.affinity.phase} linked=${sanitizeDiagnosticURL(linkedConversation || homeURL)}`)
    return linkedConversation
  }

  function proposeCurrentChatGPTAffinity(cacheKey, entry, linkedConversation, currentConversation) {
    if (!currentConversation || !linkedConversation || currentConversation === linkedConversation) return currentConversation
    const candidate = proposeChatGPTAffinity(entry.affinity, currentConversation)
    if (candidate) {
      console.log(`[chatgpt-affinity] rebind-candidate key=${cacheKey} url=${sanitizeDiagnosticURL(candidate)}`)
      publishChatGPTState(cacheKey)
    }
    return currentConversation
  }

  function settleChatGPTAffinityAfterSubmit(cacheKey, entry, conversationURL) {
    const concrete = canonicalChatGPTConversationURL(conversationURL)
    if (!concrete) return ''
    observeChatGPTAffinityURL(cacheKey, entry, concrete)
    let candidate = settleChatGPTAffinity(entry.affinity, concrete)
    if (!candidate && !entry.affinity.boundURL && entry.affinity.phase === 'unbound') {
      candidate = proposeChatGPTAffinity(entry.affinity, concrete)
    } else if (!candidate && entry.affinity.phase === 'candidate' && entry.affinity.candidateURL === concrete) {
      candidate = concrete
    }
    if (candidate) {
      clearTimeout(entry.affinitySettleTimer)
      entry.affinitySettleTimer = undefined
      console.log(`[chatgpt-affinity] definitive-candidate key=${cacheKey} url=${sanitizeDiagnosticURL(candidate)}`)
      publishChatGPTState(cacheKey)
    }
    return concrete
  }

  function scheduleChatGPTAffinitySettlement(cacheKey, entry) {
    clearTimeout(entry.affinitySettleTimer)
    entry.affinitySettleTimer = undefined
    if (!isChatGPTAffinityAwaitingSettlement(entry.affinity)) return
    if (!canonicalChatGPTConversationURL(entry.view.webContents.getURL())) return
    entry.affinitySettleTimer = setTimeout(async () => {
      entry.affinitySettleTimer = undefined
      if (chatGPTKeyForEntry(entry) !== cacheKey || !isChatGPTAffinityAwaitingSettlement(entry.affinity)) return
      const stableURL = await waitForConcreteChatGPTConversation(entry.view.webContents, 2_500)
      if (stableURL && isChatGPTAffinityAwaitingSettlement(entry.affinity)) settleChatGPTAffinityAfterSubmit(cacheKey, entry, stableURL)
    }, 0)
  }

  return {
    isChatGPTNewChatSurfaceURL, observeChatGPTAffinityURL, syncChatGPTAffinityURL,
    proposeCurrentChatGPTAffinity, settleChatGPTAffinityAfterSubmit,
    scheduleChatGPTAffinitySettlement,
  }
}

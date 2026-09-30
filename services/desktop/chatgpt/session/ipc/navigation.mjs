export function registerChatGPTNavigationIPC({
  ipcMain, trustedSender, sanitizeChatCacheKey, requireTrustedChatGPTURL,
  homeURL, deferSupervisorNavigationIfBusy, currentChatGPTState,
  activateChatGPTView, canonicalChatGPTConversationURL,
  shouldPreserveChatGPTAffinityNavigation, syncChatGPTAffinityURL,
  chatGPTConversationID, isTrustedChatGPTOrigin, sameConversationURL,
  loadOwnedChatGPTURL, observeChatGPTAffinityURL,
  scheduleChatGPTAffinitySettlement, ensureChatGPTView,
  requireOwnedChatGPTEntry, confirmChatGPTAffinity, sanitizeDiagnosticURL,
  publishChatGPTState, publicChatGPTAffinity, rejectChatGPTAffinity,
  reloadOwnedChatGPTConversation,
}) {
  ipcMain.handle('wharness:chatgpt:navigate', async (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const target = requireTrustedChatGPTURL(request?.url || homeURL)
    if (deferSupervisorNavigationIfBusy(key, windowState, request)) {
      return currentChatGPTState(key, windowState)
    }
    // Only show may reveal a hidden native view; navigation preserves the
    // local overlay's visibility decision.
    const entry = activateChatGPTView(key, request?.bounds, windowState)
    const wc = entry.view.webContents
    const current = wc.getURL()
    const linkedConversation = canonicalChatGPTConversationURL(target)
    const targetIsHome = target === homeURL
    const unboundHomeIntent = Boolean(request?.resetToHomeIfConversation && targetIsHome && !linkedConversation)
    const preservePendingConversation = !linkedConversation && shouldPreserveChatGPTAffinityNavigation(entry.affinity)
    if (!preservePendingConversation) syncChatGPTAffinityURL(key, entry, linkedConversation)
    const resetToHome = Boolean(!preservePendingConversation && unboundHomeIntent && chatGPTConversationID(current))
    const keepCachedDOM = !resetToHome && targetIsHome && isTrustedChatGPTOrigin(current) && current !== 'about:blank'
    if (resetToHome || (!keepCachedDOM && current !== target && !sameConversationURL(current, target))) {
      await loadOwnedChatGPTURL(key, entry, target, 'renderer-navigate')
    }
    if (!linkedConversation) {
      observeChatGPTAffinityURL(key, entry, wc.getURL())
      scheduleChatGPTAffinitySettlement(key, entry)
    }
    return currentChatGPTState(key, windowState)
  })
  ipcMain.handle('wharness:chatgpt:confirm-affinity', (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const { entry } = ensureChatGPTView(key, windowState)
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    const confirmedURL = confirmChatGPTAffinity(entry.affinity, request?.conversationUrl, wc.getURL())
    console.log('[chatgpt-affinity] confirmed key=' + key + ' url=' + sanitizeDiagnosticURL(confirmedURL))
    publishChatGPTState(key)
    return { ok: true, cacheKey: key, conversationUrl: confirmedURL, ...publicChatGPTAffinity(entry.affinity) }
  })
  ipcMain.handle('wharness:chatgpt:reject-affinity', async (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const { entry } = ensureChatGPTView(key, windowState)
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    const rejectedURL = canonicalChatGPTConversationURL(request?.conversationUrl || '')
    rejectChatGPTAffinity(entry.affinity, rejectedURL)
    const fallbackURL = entry.affinity.boundURL || homeURL
    if (rejectedURL && sameConversationURL(wc.getURL(), rejectedURL) && !sameConversationURL(wc.getURL(), fallbackURL)) {
      await loadOwnedChatGPTURL(key, entry, fallbackURL, 'affinity-reject')
    }
    if (!entry.affinity.boundURL) observeChatGPTAffinityURL(key, entry, wc.getURL())
    console.log('[chatgpt-affinity] rejected key=' + key + ' url=' + sanitizeDiagnosticURL(rejectedURL))
    publishChatGPTState(key)
    return { ok: true, cacheKey: key, ...publicChatGPTAffinity(entry.affinity) }
  })
  ipcMain.handle('wharness:chatgpt:reload', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    await reloadOwnedChatGPTConversation(key, entry, 'manual-reload')
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:back', (event, request) => {
    const windowState = trustedSender(event)
    const { entry } = ensureChatGPTView(request?.cacheKey, windowState)
    const { wc } = requireOwnedChatGPTEntry(request?.cacheKey, entry)
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:forward', (event, request) => {
    const windowState = trustedSender(event)
    const { entry } = ensureChatGPTView(request?.cacheKey, windowState)
    const { wc } = requireOwnedChatGPTEntry(request?.cacheKey, entry)
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    return { ok: true }
  })
}

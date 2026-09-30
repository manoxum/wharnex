export function createChatGPTViewCleanup({
  internalChatGPTBrowsers, chatGPTAuthBrowsers, chatgptViews,
  chatGPTWorkerEntries, desktopWindows, hideChatAgentInteractionsForWindow,
  grantChatGPTLayoutViewport, retireChatGPTSupervisorSurface,
  closeManagedBrowserAuth,
}) {
  function closeInternalChatGPTBrowserForWindow(windowState) {
    const browser = internalChatGPTBrowsers.get(windowState?.id)
    if (!browser) return false
    internalChatGPTBrowsers.delete(windowState.id)
    if (!browser.isDestroyed()) browser.close()
    return true
  }

  function closeAllInternalChatGPTBrowsers() {
    for (const browser of internalChatGPTBrowsers.values()) if (!browser.isDestroyed()) browser.close()
    internalChatGPTBrowsers.clear()
  }

  function rehomeChatGPTWorkers(windowState) {
    hideChatAgentInteractionsForWindow(windowState)
    const replacement = [...desktopWindows.values()].find((state) => state.id !== windowState?.id && state.window && !state.window.isDestroyed())
    if (!replacement) return false
    for (const entry of chatGPTWorkerEntries) {
      if (entry.ownerWindowId !== windowState.id || entry.view.webContents.isDestroyed()) continue
      if (entry.attached) {
        try { windowState.window.contentView.removeChildView?.(entry.view) } catch { /* already detached */ }
        replacement.window.contentView.addChildView(entry.view)
      }
      entry.ownerWindowId = replacement.id
      entry.interactionWindowId = ''
      entry.parkedLayout = true
      // Re-parenting rebuilds the native view hierarchy and its renderer viewport.
      grantChatGPTLayoutViewport(entry.view)
      entry.layoutViewportGranted = true
    }
    return true
  }

  function closeChatGPTViewsForWindow(windowState) {
    for (const [key, entry] of [...chatgptViews.entries()]) if (entry.ownerWindowId === windowState.id) retireChatGPTSupervisorSurface(key)
    windowState.activeChatGPTKey = ''
    windowState.chatgptVisible = false
  }

  function closeAllChatGPTViews() {
    for (const record of chatGPTAuthBrowsers.values()) {
      record.cancelled = true
      void closeManagedBrowserAuth(record)
    }
    chatGPTAuthBrowsers.clear()
    for (const entry of chatgptViews.values()) {
      clearTimeout(entry.affinitySettleTimer)
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    }
    chatgptViews.clear()
    for (const entry of chatGPTWorkerEntries.splice(0)) {
      clearTimeout(entry.affinitySettleTimer)
      if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    }
    for (const state of desktopWindows.values()) { state.activeChatGPTKey = ''; state.chatgptVisible = false; state.activeAgentInteractionId = '' }
  }

  return {
    closeInternalChatGPTBrowserForWindow, closeAllInternalChatGPTBrowsers,
    rehomeChatGPTWorkers, closeChatGPTViewsForWindow, closeAllChatGPTViews,
  }
}

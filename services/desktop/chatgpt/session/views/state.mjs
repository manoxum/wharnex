export function createChatGPTViewState({
  chatgptViews, desktopWindows, chatGPTAuthBrowsers,
  sanitizeChatCacheKey, normalizeBounds, activeChatGPTEntry,
  getDeferredSupervisorNavigation, publicSupervisorId,
  manualChatGPTTransport, publicChatGPTAffinity,
  windowStateForEntry, sendToWindowState, homeURL,
}) {
  function setChatGPTBounds(value, windowState) {
    const bounds = normalizeBounds(value, windowState?.window?.getContentBounds())
    const entry = activeChatGPTEntry(windowState)
    if (!bounds || !entry) return false
    windowState.chatgptBounds = bounds
    entry.view.setBounds(bounds)
    // A real pane is now laid out and can be shown.
    entry.parkedLayout = false
    return true
  }

  function currentChatGPTState(cacheKey = '', windowState) {
    const defaultKey = windowState?.activeChatGPTKey || ''
    const key = cacheKey ? sanitizeChatCacheKey(cacheKey) : defaultKey
    const entry = key ? chatgptViews.get(key) : undefined
    if (entry && windowState && entry.ownerWindowId !== windowState.id) throw new Error('ChatGPT view belongs to another Wharnex window')
    const deferred = getDeferredSupervisorNavigation()
    const surfaceDeferred = Boolean(key && deferred?.key === key && (!windowState || deferred.windowState === windowState))
    const wc = entry?.view.webContents
    return {
      cacheKey: key,
      surfaceDeferred,
      supervisorId: publicSupervisorId(entry),
      url: wc?.getURL() || homeURL,
      title: wc?.getTitle() || 'ChatGPT',
      loading: entry?.loading ?? true,
      canGoBack: Boolean(wc?.navigationHistory.canGoBack()),
      canGoForward: Boolean(wc?.navigationHistory.canGoForward()),
      externalAuthProvider: entry?.externalAuthProvider || '',
      authMode: entry?.authMode || 'embedded',
      authWindowOpen: Boolean(key && chatGPTAuthBrowsers.has(key)),
      authenticated: Boolean(entry?.authenticated),
      humanAction: entry?.humanAction?.active ? { cacheKey: key, ...entry.humanAction } : undefined,
      manualInput: key ? manualChatGPTTransport.publicState(key) : undefined,
      ...publicChatGPTAffinity(entry?.affinity),
    }
  }

  function publishChatGPTState(key = '') {
    if (!key) {
      for (const state of desktopWindows.values()) if (state.activeChatGPTKey) publishChatGPTState(state.activeChatGPTKey)
      return
    }
    const entry = chatgptViews.get(key)
    const state = windowStateForEntry(entry)
    if (!state) return
    sendToWindowState(state, 'wharness:chatgpt:state', currentChatGPTState(key, state))
  }

  return { setChatGPTBounds, currentChatGPTState, publishChatGPTState }
}

export function registerChatGPTVisibilityIPC({
  ipcMain, trustedSender, deferSupervisorNavigationIfBusy,
  activateChatGPTView, requireTrustedChatGPTURL, homeURL,
  isTrustedChatGPTOrigin, loadOwnedChatGPTURL, sanitizeChatCacheKey,
  waitForChatGPTSurfaceReady, chatgptViews, getDeferredSupervisorNavigation,
  reconcileChatGPTThrottle, setChatGPTBounds,
}) {
  ipcMain.handle('wharness:chatgpt:show', async (event, request) => {
    const windowState = trustedSender(event)
    windowState.chatgptVisible = true
    if (deferSupervisorNavigationIfBusy(request?.cacheKey, windowState, { ...request, visible: true })) {
      return { ok: true, deferred: true }
    }
    const entry = activateChatGPTView(request?.cacheKey, request?.bounds, windowState)
    const wc = entry.view.webContents
    // The first visible view needs its own concrete navigation. A separate
    // renderer navigate IPC may be delayed after show.
    const initialTarget = request?.url ? requireTrustedChatGPTURL(request.url) : homeURL
    if (!isTrustedChatGPTOrigin(wc.getURL())) {
      void loadOwnedChatGPTURL(request?.cacheKey, entry, initialTarget, 'initial-show').catch((error) => {
        console.error('[chatgpt-load] initial-show failed key=' + sanitizeChatCacheKey(request?.cacheKey) + ' error=' + (error?.message || 'unknown'))
      })
    }
    if (isTrustedChatGPTOrigin(wc.getURL())) {
      await waitForChatGPTSurfaceReady(request?.cacheKey, entry)
    }
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:hide', (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const entry = chatgptViews.get(key)
    const deferred = getDeferredSupervisorNavigation()
    if (entry?.ownerWindowId === windowState.id) entry.view.setVisible(false)
    if (windowState.activeChatGPTKey === key || (deferred?.key === key && deferred.windowState === windowState)) windowState.chatgptVisible = false
    if (deferred?.key === key && deferred.windowState === windowState) deferred.visible = false
    if (entry) reconcileChatGPTThrottle(key, entry)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:set-bounds', (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    if (key !== windowState.activeChatGPTKey || !windowState.chatgptVisible) return { ok: false }
    return { ok: setChatGPTBounds(request?.bounds, windowState) }
  })
}

export function registerChatGPTModeIPC({
  ipcMain, trustedSender, sanitizeChatGPTAuthMode,
  ensureChatGPTView, requireOwnedChatGPTEntry,
  cancelExternalAuthentication, chatGPTSurfaceShouldBeVisible,
  publishChatGPTState, currentChatGPTState,
  sanitizeChatCacheKey, chatgptTransportModes,
  abortChatGPTTransportPreparations, preparedChatGPTDrafts,
  retryableChatGPTPrompts, expectedChatGPTBundles,
  manualChatGPTTransport, chatgptViews,
}) {
  ipcMain.handle('wharness:chatgpt:set-auth-mode', async (event, request) => {
    const windowState = trustedSender(event)
    const mode = sanitizeChatGPTAuthMode(request?.mode)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(key, entry)
    entry.authMode = mode
    if (mode === 'embedded') {
      cancelExternalAuthentication(key)
      entry.externalAuthProvider = ''
      if (windowState.activeChatGPTKey === key) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, windowState))
    }
    publishChatGPTState(key)
    return currentChatGPTState(key, windowState)
  })
  ipcMain.handle('wharness:chatgpt:set-transport-mode', async (event, request) => {
    trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const mode = request?.mode === 'manual' ? 'manual' : 'scraper'
    if (mode === 'manual') {
      chatgptTransportModes.set(key, 'manual')
      abortChatGPTTransportPreparations(key)
      preparedChatGPTDrafts.delete(key)
      retryableChatGPTPrompts.delete(key)
      expectedChatGPTBundles.delete(key)
    } else chatgptTransportModes.delete(key)
    await manualChatGPTTransport.setMode(key, mode, chatgptViews.get(key)?.view?.webContents)
    publishChatGPTState(key)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:copy-pending-bundles', async (event, request) => {
    trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    if (chatgptTransportModes.get(key) !== 'manual') throw new Error('A cópia do bundle pendente só está disponível no transporte Manual.')
    return manualChatGPTTransport.copyPendingBundles(key, request?.requestId)
  })
}

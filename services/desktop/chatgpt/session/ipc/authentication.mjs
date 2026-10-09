export function registerChatGPTAuthenticationIPC({
  ipcMain, trustedSender, sanitizeChatGPTAuthMode,
  ensureChatGPTView, requireOwnedChatGPTEntry,
  cancelExternalAuthentication, startExternalAuthentication,
  currentChatGPTState, loadOwnedChatGPTURL, loginURL,
  chatGPTSurfaceShouldBeVisible, publishChatGPTState,
  requireTrustedChatGPTURL, homeURL, openOwnedChatGPTBrowser,
  openInternalChatGPTBrowser, isTrustedChatGPTOrigin,
}) {
  ipcMain.handle('wharness:chatgpt:start-auth', async (event, request) => {
    const windowState = trustedSender(event)
    const mode = sanitizeChatGPTAuthMode(request?.mode)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(key, entry)
    entry.authMode = mode
    entry.externalAuthProvider = ''
    entry.embeddedAuthActive = mode === 'embedded'
    entry.embeddedAuthCrossedBoundary = false
    if (mode === 'external') {
      cancelExternalAuthentication(key)
      startExternalAuthentication(entry, 'OpenAI')
      return currentChatGPTState(key, windowState)
    }
    cancelExternalAuthentication(key)
    await loadOwnedChatGPTURL(key, entry, loginURL, 'embedded-auth')
    requireOwnedChatGPTEntry(key, entry)
    if (windowState.activeChatGPTKey === key) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, windowState))
    publishChatGPTState(key)
    return currentChatGPTState(key, windowState)
  })
  ipcMain.handle('wharness:chatgpt:open-external', async (event, request) => {
    trustedSender(event)
    const target = requireTrustedChatGPTURL(request?.url || homeURL)
    await openOwnedChatGPTBrowser(target)
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:open-internal', (event, request) => {
    const windowState = trustedSender(event)
    return openInternalChatGPTBrowser(windowState, request?.url || homeURL)
  })
  ipcMain.handle('wharness:chatgpt:resume-embedded', async (event, request) => {
    const windowState = trustedSender(event)
    const { key, entry } = ensureChatGPTView(request?.cacheKey, windowState)
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    entry.externalAuthProvider = ''
    entry.authMode = 'embedded'
    cancelExternalAuthentication(key)
    if (!isTrustedChatGPTOrigin(wc.getURL())) await loadOwnedChatGPTURL(key, entry, homeURL, 'resume-embedded')
    requireOwnedChatGPTEntry(key, entry)
    if (windowState.activeChatGPTKey === key) entry.view.setVisible(chatGPTSurfaceShouldBeVisible(entry, windowState))
    publishChatGPTState(key)
    return currentChatGPTState(key, windowState)
  })
}

export function registerChatGPTStateIPC({
  ipcMain, trustedSender, currentChatGPTState, sanitizeChatCacheKey,
  chatgptViews, requireOwnedChatGPTEntry, releaseChatGPTView,
  ensureChatGPTView,
}) {
  ipcMain.handle('wharness:chatgpt:state', (event, request) => {
    const windowState = trustedSender(event)
    return currentChatGPTState(request?.cacheKey, windowState)
  })
  ipcMain.handle('wharness:chatgpt:open-devtools', (event, request) => {
    const windowState = trustedSender(event)
    const key = sanitizeChatCacheKey(request?.cacheKey)
    const entry = chatgptViews.get(key)
    if (!entry || entry.ownerWindowId !== windowState.id) throw new Error('Current ChatGPT browser instance is not available')
    const { wc } = requireOwnedChatGPTEntry(key, entry)
    wc.openDevTools({ mode: 'detach', activate: true })
    return { ok: true }
  })
  ipcMain.handle('wharness:chatgpt:release', (event, request) => {
    const windowState = trustedSender(event)
    return { ok: true, released: releaseChatGPTView(request?.cacheKey, windowState) }
  })
  ipcMain.handle('wharness:chatgpt:live-keys', (event) => {
    const windowState = trustedSender(event)
    return [...chatgptViews.entries()]
      .filter(([, entry]) => entry.ownerWindowId === windowState.id)
      .map(([key]) => key)
  })
  ipcMain.handle('wharness:chatgpt:paste', (event, request) => {
    const windowState = trustedSender(event)
    const { entry } = ensureChatGPTView(request?.cacheKey, windowState)
    requireOwnedChatGPTEntry(request?.cacheKey, entry).wc.paste()
    return { ok: true }
  })
}

export function createDesktopMessageRouting({ desktopWindows, chatgptViews }) {
  function windowStateForWebContents(webContents) {
    if (!webContents) return undefined
    return [...desktopWindows.values()].find((state) => state.window?.webContents?.id === webContents.id)
  }

  function trustedSender(event) {
    const state = windowStateForWebContents(event?.sender)
    if (!state || state.window.isDestroyed()) throw new Error('Untrusted IPC sender')
    return state
  }

  function windowStateForEntry(entry) {
    return entry ? desktopWindows.get(entry.ownerWindowId) : undefined
  }

  function activeChatGPTEntry(windowState) {
    const state = windowState || windowStateForEntry([...chatgptViews.values()].find((entry) => entry.view.isVisible?.()))
    return state?.activeChatGPTKey ? chatgptViews.get(state.activeChatGPTKey) : undefined
  }

  function sendToWindowState(state, channel, payload) {
    if (state?.window && !state.window.isDestroyed()) state.window.webContents.send(channel, payload)
  }

  function sendToChatGPTKey(cacheKey, channel, payload) {
    const entry = cacheKey ? chatgptViews.get(cacheKey) : undefined
    const state = windowStateForEntry(entry)
    if (state) sendToWindowState(state, channel, payload)
  }

  function publishChatGPTAccountAction(cacheKey, action, result) {
    sendToChatGPTKey(cacheKey, 'wharness:chatgpt:account-action', {
      cacheKey,
      action,
      ok: result?.ok === true,
      state: String(result?.state || 'unknown').slice(0, 120),
      provider: String(result?.provider || 'typed-browser').slice(0, 40),
    })
  }

  return {
    windowStateForWebContents, trustedSender, windowStateForEntry,
    activeChatGPTEntry, sendToWindowState, sendToChatGPTKey,
    publishChatGPTAccountAction,
  }
}

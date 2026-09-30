export function createInternalChatGPTBrowser({ BrowserWindow, shell, browsers, trustedURL, isTrustedOrigin, isHTTPS, titleFor, securePreferences, partition, userAgent, icon, instance, homeURL }) {
  return function openInternalChatGPTBrowser(windowState, value) {
    if (!windowState?.window || windowState.window.isDestroyed()) throw new Error('Cannot open internal ChatGPT browser without an owning Wharnex window')
    const target = trustedURL(value || homeURL)
    const existing = browsers.get(windowState.id)
    if (existing && !existing.isDestroyed()) {
      if (existing.webContents.getURL() !== target) void existing.loadURL(target).catch((error) => console.error(`[chatgpt-internal-browser] navigation failed error=${error?.message || 'unknown'}`))
      existing.show()
      existing.focus()
      return { ok: true, reused: true }
    }

    const browser = new BrowserWindow({
      width: 1280, height: 860, minWidth: 900, minHeight: 640,
      title: titleFor(windowState.activeProject, instance), icon,
      parent: windowState.window, autoHideMenuBar: true,
      webPreferences: securePreferences({ partition, backgroundThrottling: false }),
    })
    browsers.set(windowState.id, browser)
    browser.webContents.setUserAgent(userAgent)
    browser.webContents.setWindowOpenHandler(({ url }) => {
      if (isTrustedOrigin(url)) {
        void browser.loadURL(trustedURL(url)).catch((error) => console.error(`[chatgpt-internal-browser] popup navigation failed error=${error?.message || 'unknown'}`))
      } else if (isHTTPS(url)) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })
    browser.webContents.on('will-navigate', (event, url) => {
      if (isTrustedOrigin(url)) return
      event.preventDefault()
      if (isHTTPS(url)) void shell.openExternal(url)
    })
    browser.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[chatgpt-internal-browser] renderer gone reason=${details.reason} exitCode=${details.exitCode}`)
    })
    browser.on('closed', () => {
      if (browsers.get(windowState.id) === browser) browsers.delete(windowState.id)
    })
    void browser.loadURL(target).catch((error) => console.error(`[chatgpt-internal-browser] initial load failed error=${error?.message || 'unknown'}`))
    return { ok: true, reused: false }
  }
}

import { createHostedChatGPTSurface } from '../../../chatgpt/session/views/surface.mjs'

const CONVERSATION_URL = /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]{1,128}$/

function canonicalConversationURL(value) {
  const raw = String(value || '').trim()
  if (!CONVERSATION_URL.test(raw)) throw new Error('Link de conversa GPT inválido')
  return raw
}

// Human-only, short-lived viewer: it never joins the Supervisor/Worker pools,
// acquires a task lease, registers transport listeners, or reads page content.
export function createBrowserMonitorLink({ WebContentsView, securePreferences, CHATGPT_PARTITION, CHATGPT_USER_AGENT, browserHost, releaseAgent, requireMonitor, normalizeMonitorBounds }) {
  function close(windowState, expectedURL = '') {
    requireMonitor(windowState)
    const entry = windowState.activeMonitorLinkEntry
    if (!entry || (expectedURL && entry.url !== expectedURL)) return { ok: true, closed: false }
    windowState.activeMonitorLinkEntry = undefined
    entry.view.release()
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
    return { ok: true, closed: true }
  }

  function release(windowState, expectedURL = '') {
    requireMonitor(windowState)
    const entry = windowState.activeMonitorLinkEntry
    if (!entry || (expectedURL && entry.url !== expectedURL)) return { ok: true, released: false }
    entry.view.release()
    return { ok: true, released: true }
  }

  function present(rawURL, rawBounds, windowState) {
    requireMonitor(windowState)
    const url = canonicalConversationURL(rawURL)
    const bounds = normalizeMonitorBounds(rawBounds, windowState)
    releaseAgent(windowState)
    let entry = windowState.activeMonitorLinkEntry
    if (entry?.url !== url || entry.view.webContents.isDestroyed()) {
      close(windowState)
      const native = new WebContentsView({ webPreferences: securePreferences({ partition: CHATGPT_PARTITION, backgroundThrottling: false }) })
      native.setBackgroundColor('#ffffff')
      const view = createHostedChatGPTSurface(native, { View: browserHost.View, host: browserHost })
      entry = { url, view }
      windowState.activeMonitorLinkEntry = entry
      view.webContents.setUserAgent(CHATGPT_USER_AGENT)
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      view.webContents.on('will-navigate', (event, target) => {
        if (target.startsWith('https://chatgpt.com/')) return
        event.preventDefault()
      })
      void view.webContents.loadURL(url).catch(() => undefined)
    }
    entry.view.present(windowState.window, bounds)
    return { ok: true, url, bounds }
  }

  function resize(rawBounds, windowState) {
    requireMonitor(windowState)
    const entry = windowState.activeMonitorLinkEntry
    if (!entry || !entry.view.isPresented()) return { ok: false }
    const bounds = normalizeMonitorBounds(rawBounds, windowState)
    entry.view.resizePresented(bounds)
    return { ok: true, bounds }
  }

  return { presentBrowserLinkInMonitor: present, resizeBrowserLinkInMonitor: resize, releaseBrowserLinkInMonitor: release, closeBrowserLinkInMonitor: close }
}

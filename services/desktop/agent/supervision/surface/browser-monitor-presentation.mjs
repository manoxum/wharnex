import { createBrowserMonitorLink } from './browser-monitor-link.mjs'

const MONITOR_WINDOW_ID = 'browser-monitor'

// Presenting moves an agent view's container from the browser host into the
// monitor pane and back (see chatgpt/session/views/surface.mjs); the view keeps
// its renderer, chat, task and lease. Only one instance is presented.
export function createBrowserMonitorPresentation({
  desktopWindows, chatgptViews, chatGPTWorkerEntries, normalizeBounds,
  publishChatAgentRuntimeState, WebContentsView, securePreferences,
  CHATGPT_PARTITION, CHATGPT_USER_AGENT, browserHost,
}) {
  function requireMonitor(windowState) {
    if (windowState?.id !== MONITOR_WINDOW_ID || windowState.window?.isDestroyed()) throw new Error('A apresentação de navegadores pertence apenas ao monitor')
    return windowState
  }

  function agentEntry(agentId) {
    const id = String(agentId || '').trim()
    const entry = /^supervisor-[1-9][0-9]?$/.test(id)
      ? [...chatgptViews.values()].find((candidate) => candidate.slotId === id)
      : /^worker-[1-9][0-9]?$/.test(id) || /^(?:ephemeral|translator)-cat_[a-f0-9]{20}$/.test(id)
        ? chatGPTWorkerEntries.find((candidate) => candidate.slotId === id) : undefined
    if (!entry?.view?.webContents || entry.view.webContents.isDestroyed() || typeof entry.view.present !== 'function') throw new Error('Instância do navegador indisponível')
    return entry
  }

  // Zoom is shared by every view of an origin (Chromium's zoom policy), so it
  // cannot compensate one Worker's layout without rescaling every ChatGPT
  // view; a Worker is presented at its own content size instead.
  const presentOptions = (entry) => ({ keepContentSize: entry.role === 'worker' })

  function releaseAgent(windowState, agentId = '') {
    requireMonitor(windowState)
    const entry = windowState.activeMonitorAgentEntry
    if (!entry || (agentId && entry.slotId !== agentId)) return { ok: true, agentId, released: false }
    windowState.activeMonitorAgentEntry = undefined
    windowState.activeMonitorAgentId = ''
    entry.monitorWindowId = ''
    if (!entry.view.webContents.isDestroyed()) entry.view.release()
    publishChatAgentRuntimeState()
    return { ok: true, agentId: entry.slotId, released: true }
  }

  function normalizedMonitorBounds(rawBounds, windowState) {
    const bounds = normalizeBounds(rawBounds, windowState.window.getContentBounds())
    if (!bounds || bounds.width < 80 || bounds.height < 80) throw new Error('Área do navegador inválida')
    return bounds
  }

  const link = createBrowserMonitorLink({ WebContentsView, securePreferences, CHATGPT_PARTITION,
    CHATGPT_USER_AGENT, browserHost, releaseAgent, requireMonitor,
    normalizeMonitorBounds: normalizedMonitorBounds })

  function releaseBrowserMonitor(windowState, agentId = '') {
    if (agentId) return releaseAgent(windowState, agentId)
    link.closeBrowserLinkInMonitor(windowState)
    return releaseAgent(windowState)
  }

  function presentBrowserInMonitor(agentId, rawBounds, windowState) {
    requireMonitor(windowState)
    const entry = agentEntry(agentId)
    const bounds = normalizedMonitorBounds(rawBounds, windowState)
    if (windowState.activeMonitorAgentEntry === entry) return resizeBrowserInMonitor(entry.slotId, bounds, windowState)
    link.closeBrowserLinkInMonitor(windowState)
    releaseAgent(windowState)
    entry.monitorWindowId = windowState.id
    entry.view.present(windowState.window, bounds, presentOptions(entry))
    windowState.activeMonitorAgentEntry = entry
    windowState.activeMonitorAgentId = entry.slotId
    publishChatAgentRuntimeState()
    return { ok: true, agentId: entry.slotId, bounds }
  }

  function resizeBrowserInMonitor(agentId, rawBounds, windowState) {
    requireMonitor(windowState)
    const entry = windowState.activeMonitorAgentEntry
    if (!entry || entry.slotId !== agentId || entry.view.webContents.isDestroyed()) return { ok: false, agentId }
    const bounds = normalizedMonitorBounds(rawBounds, windowState)
    entry.view.resizePresented(bounds)
    return { ok: true, agentId, bounds }
  }

  return { presentBrowserInMonitor, resizeBrowserInMonitor, releaseBrowserMonitor, ...link }
}

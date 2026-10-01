const MONITOR_WINDOW_ID = 'browser-monitor'
const PARKED_SIZE = Object.freeze({ width: 1280, height: 900 })

// Presenting moves an agent view's container from the browser host into the
// monitor pane and back (see chatgpt/session/views/surface.mjs); the view keeps
// its renderer, chat, task and lease. Only one instance is presented.
export function createBrowserMonitorPresentation({
  desktopWindows, chatgptViews, chatGPTWorkerEntries, normalizeBounds,
  publishChatAgentRuntimeState,
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

  // A running Worker keeps an automation-sized effective viewport: the zoom
  // compensates for a monitor pane smaller than the parked layout.
  function fit(entry, bounds) {
    const wc = entry.view.webContents
    if (entry.role === 'worker' && typeof wc.setZoomFactor === 'function') {
      wc.setZoomFactor(Math.max(0.25, Math.min(1, bounds.width / PARKED_SIZE.width, bounds.height / PARKED_SIZE.height)))
    }
  }

  function releaseBrowserMonitor(windowState, agentId = '') {
    requireMonitor(windowState)
    const entry = windowState.activeMonitorAgentEntry
    if (!entry || (agentId && entry.slotId !== agentId)) return { ok: true, agentId, released: false }
    windowState.activeMonitorAgentEntry = undefined
    windowState.activeMonitorAgentId = ''
    entry.monitorWindowId = ''
    const wc = entry.view.webContents
    if (!wc.isDestroyed()) {
      if (Number.isFinite(entry.monitorPreviousZoomFactor)) wc.setZoomFactor(entry.monitorPreviousZoomFactor)
      entry.view.release()
    }
    entry.monitorPreviousZoomFactor = undefined
    publishChatAgentRuntimeState()
    return { ok: true, agentId: entry.slotId, released: true }
  }

  function normalizedMonitorBounds(rawBounds, windowState) {
    const bounds = normalizeBounds(rawBounds, windowState.window.getContentBounds())
    if (!bounds || bounds.width < 80 || bounds.height < 80) throw new Error('Área do navegador inválida')
    return bounds
  }

  function presentBrowserInMonitor(agentId, rawBounds, windowState) {
    requireMonitor(windowState)
    const entry = agentEntry(agentId)
    const bounds = normalizedMonitorBounds(rawBounds, windowState)
    if (windowState.activeMonitorAgentEntry === entry) return resizeBrowserInMonitor(entry.slotId, bounds, windowState)
    releaseBrowserMonitor(windowState)
    entry.monitorPreviousZoomFactor = entry.view.webContents.getZoomFactor?.() ?? 1
    entry.monitorWindowId = windowState.id
    fit(entry, bounds)
    entry.view.present(windowState.window, bounds)
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
    fit(entry, bounds)
    entry.view.resizePresented(bounds)
    return { ok: true, agentId, bounds }
  }

  return { presentBrowserInMonitor, resizeBrowserInMonitor, releaseBrowserMonitor }
}

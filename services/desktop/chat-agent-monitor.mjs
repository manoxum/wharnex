export const WORKER_MONITOR_VIEWPORT = Object.freeze({ x: 0, y: 0, width: 1280, height: 900 })

// Moves the existing Worker view into a full-size user window. Its renderer,
// session, conversation, and scheduler lease remain the same throughout.
export function openWorkerMonitor(entry, BrowserWindow, onClosed = () => {}) {
  if (entry.monitorWindow && !entry.monitorWindow.isDestroyed()) {
    entry.monitorWindow.show()
    return { ok: true, agentId: entry.slotId, alreadyOpen: true }
  }
  if (entry.interactionWindowId) throw new Error('Feche a interação direta antes de acompanhar este Worker')
  const monitor = new BrowserWindow({
    width: WORKER_MONITOR_VIEWPORT.width,
    height: WORKER_MONITOR_VIEWPORT.height,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    show: false,
    autoHideMenuBar: true,
    title: `Wharnex · ${entry.slotId}`,
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  })
  entry.monitorWindow = monitor
  const detach = () => {
    if (entry.monitorWindow !== monitor) return
    entry.monitorWindow = undefined
    try { monitor.contentView.removeChildView(entry.view) } catch { /* window is closing */ }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.setVisible(false)
      entry.view.setBounds({ ...WORKER_MONITOR_VIEWPORT })
      entry.parkedLayout = true
      entry.layoutViewportGranted = true
    }
    onClosed(entry)
  }
  monitor.on('close', detach)
  try {
    entry.view.setBounds({ ...WORKER_MONITOR_VIEWPORT })
    monitor.contentView.addChildView(entry.view)
    entry.view.setVisible(true)
    entry.parkedLayout = false
    entry.layoutViewportGranted = true
    monitor.show()
    return { ok: true, agentId: entry.slotId, alreadyOpen: false }
  } catch (error) {
    detach()
    if (!monitor.isDestroyed()) monitor.close()
    throw error
  }
}

export function closeWorkerMonitor(entry) {
  const monitor = entry?.monitorWindow
  if (!monitor || monitor.isDestroyed()) return { ok: true, agentId: entry?.slotId || '', closed: false }
  monitor.close()
  return { ok: true, agentId: entry.slotId, closed: true }
}

export function closeWorkerMonitorAfterState(entry, kind) {
  if (['settled', 'task-error', 'worker-error', 'worker-stopped'].includes(kind)) closeWorkerMonitor(entry)
}

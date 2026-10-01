export const BROWSER_MONITOR_WINDOW_ID = 'browser-monitor'

function liveMonitor(windows) {
  const state = windows.get(BROWSER_MONITOR_WINDOW_ID)
  return state?.window && !state.window.isDestroyed() ? state : undefined
}

export function createBrowserMonitorOpener(windows, createWindow) {
  return (agentId = '') => {
    const existing = liveMonitor(windows)
    const selected = /^[a-z0-9_-]{1,80}$/i.test(String(agentId || '')) ? String(agentId) : ''
    if (existing) {
      if (existing.window.isMinimized()) existing.window.restore()
      existing.window.show()
      existing.window.focus()
      if (selected) existing.window.webContents.send('wharness:agents:monitor-select', { agentId: selected })
      return existing
    }
    return createWindow(BROWSER_MONITOR_WINDOW_ID, false, { browserMonitor: true, ...(selected ? { selectAgent: selected } : {}) })
  }
}

// The one physical home of every ChatGPT agent view. A view in a window that is
// hidden or never shown has no compositor surface, so neither the browser
// monitor (which the user closes to the background) nor a project window can
// hold them. This window is mapped but one pixel, unfocusable, click-through
// and off the taskbar; the views inside it are parked hidden at its origin and
// are captured from there for the project mirrors.
export function createBrowserHost({ BrowserWindow, View, windows, createWindow }) {
  let hostWindow

  function ensure() {
    if (hostWindow && !hostWindow.isDestroyed()) return hostWindow
    hostWindow = new BrowserWindow({
      width: 1, height: 1, x: 0, y: 0, show: false, frame: false, transparent: false,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, focusable: false, hasShadow: false, title: 'Wharnex · navegadores',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    hostWindow.setIgnoreMouseEvents(true)
    hostWindow.showInactive()
    return hostWindow
  }

  function attach(box) {
    ensure().contentView.addChildView(box)
    box.setBounds({ ...box.getBounds(), x: 0, y: 0 })
  }

  function detach(box) {
    try { if (hostWindow && !hostWindow.isDestroyed()) hostWindow.contentView.removeChildView(box) } catch { /* host is closing */ }
  }

  const open = createBrowserMonitorOpener(windows, createWindow)
  return { View, ensure, attach, detach, open }
}

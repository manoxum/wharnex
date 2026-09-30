export function registerDesktopLifecycleHandlers({
  app, desktopWindows, persistDesktopRecoverySession, persistWindowLayout,
  ensureDesktopTray, getExplicitDesktopExit, getQuitting, setQuitting,
  getDownloadPoller, getDesktopTrayControl, getWorkerScheduler,
  getTranslatorScheduler, getSupervisorScheduler, createWindow,
}) {
  app.on('before-quit', () => {
    if (!getExplicitDesktopExit()) persistDesktopRecoverySession()
    setQuitting(true)
    persistWindowLayout()
    const poller = getDownloadPoller()
    if (poller) clearInterval(poller)
    getDesktopTrayControl()?.destroy()
    const worker = getWorkerScheduler()
    const translator = getTranslatorScheduler()
    const supervisor = getSupervisorScheduler()
    if (worker) void worker.stop()
    if (translator) void translator.stop()
    if (supervisor) void supervisor.stop()
  })
  app.on('window-all-closed', () => {
    if (!getQuitting()) ensureDesktopTray()
  })
  app.on('activate', () => {
    const existing = [...desktopWindows.values()].find((state) => state.window && !state.window.isDestroyed() && !state.transientSurface)
    if (existing) { existing.window.show(); existing.window.focus(); return }
    createWindow('primary')
  })
}

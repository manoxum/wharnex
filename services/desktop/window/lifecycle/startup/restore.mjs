export function restoreDesktopWindowsAtStartup({
  loadWindowLayout, consumeRestartIntent, consumeDesktopRecoverySession,
  recoverableDesktopWindows, createWindow, persistWindowLayout, windows,
  schedule = setTimeout,
}) {
  const layout = loadWindowLayout()
  const restartIntent = consumeRestartIntent()
  const recovery = restartIntent ? undefined : consumeDesktopRecoverySession()
  if (restartIntent?.scope === 'current' && layout.includes(restartIntent.currentWindowId)) {
    // Restore the requesting window first, then the sibling topology.
    createWindow(restartIntent.currentWindowId, false)
    persistWindowLayout(layout)
    schedule(() => {
      for (const windowId of layout) if (windowId !== restartIntent.currentWindowId && !windows.has(windowId)) createWindow(windowId, false)
      persistWindowLayout()
    }, 900)
  } else if (recovery) {
    // Recovery is synchronous: an unanswered modal would stall every Worker claim.
    const records = recoverableDesktopWindows(recovery)
    for (const record of records) createWindow(record.id, false, { recovery: { projects: record.projects, activeProject: record.activeProject, pending: false } })
    persistWindowLayout(records.map((record) => record.id))
  } else {
    for (const windowId of layout) createWindow(windowId, false)
    persistWindowLayout()
  }
}

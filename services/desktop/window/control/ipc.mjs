export function registerDesktopShellIPC({
  ipcMain, trustedSender, publishDesktopNotification, canonicalProjectPath,
  desktopTrayController, persistWindowLayout, persistRestartIntent,
  desktopWindows, sendToWindowState, waitForSelfEvolutionActivation,
  scheduleDesktopCoordinatorRelaunch, app,
}) {
  ipcMain.handle('wharness:notifications:publish', (event, request) => publishDesktopNotification(trustedSender(event), request))
  ipcMain.handle('wharness:tray:update-project-state', (event, request) => {
    const windowState = trustedSender(event)
    const projectPath = canonicalProjectPath(request?.projectPath)
    if (!windowState.projects.has(projectPath)) throw new Error('Tray project does not belong to this window')
    desktopTrayController().updateProjectState(projectPath, request)
    return { ok: true }
  })
  ipcMain.handle('wharness:windows:activate-self-evolution', (event, request) => {
    const windowState = trustedSender(event)
    const allowed = new Set(['backend', 'frontend', 'desktop', 'tunnel'])
    const impacts = [...new Set(Array.isArray(request?.impacts) ? request.impacts : [])]
    if (impacts.some((impact) => !allowed.has(impact))) throw new Error('Invalid self-evolution activation impact')
    if (impacts.includes('desktop')) {
      persistWindowLayout()
      persistRestartIntent('all', windowState.id)
      for (const state of desktopWindows.values()) sendToWindowState(state, 'wharness:windows:restart-intent', { scope: 'all', currentWindowId: windowState.id, affected: true })
      setTimeout(async () => {
        if (!await waitForSelfEvolutionActivation()) return
        try {
          await scheduleDesktopCoordinatorRelaunch()
          app.exit(0)
        } catch (error) {
          console.error('[self-evolution] failed to schedule Desktop coordinator relaunch', error)
        }
      }, 0)
      return { ok: true, action: 'relaunch' }
    }
    if (impacts.includes('frontend')) {
      setTimeout(async () => {
        if (await waitForSelfEvolutionActivation()) {
          for (const state of desktopWindows.values()) if (!state.window.isDestroyed()) state.window.webContents.reload()
        }
      }, 0)
      return { ok: true, action: 'reload' }
    }
    return { ok: true, action: 'services' }
  })
}

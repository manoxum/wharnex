import { createDesktopTrayControl } from '../../tray/desktop-tray-control.mjs'
import { completionNotificationRecord } from '../../notification/desktop-notification-request.mjs'
import { createDesktopWindowCloseCoordinator } from '../../window/lifecycle/desktop-window-close.mjs'
import { nativeWindowCloseChoice } from '../../window/lifecycle/desktop-window-close-prompt.mjs'

export function createDesktopTrayComposition({
  app, dialog, Menu, Notification, Tray, nativeImage, session, icon,
  instanceName, platform, getTrayControl, setTrayControl,
  listProjects, projectLabel, restoreProject, closeProject,
  showFallback, openBrowserMonitor, sendProjectAction, projectWindowState, sendToWindowState,
  workerState, pauseWorkers, resumeWorkers,
  canonicalProjectPath, hideAgentInteractionsForWindow,
  persistWindowLayout, persistDesktopRecoverySession,
  markExplicitDesktopExit, isQuitting,
}) {
  function desktopTrayController() {
    const existing = getTrayControl()
    if (existing) return existing
    const control = createDesktopTrayControl({
      Menu, Notification, Tray, nativeImage, icon, instanceName, platform,
      listProjects, projectLabel, restoreProject, closeProject, showFallback, openBrowserMonitor,
      quit: requestFullDesktopQuit, sendProjectAction,
      sendNotificationOpen: (projectPath, record) => {
        const state = projectWindowState(projectPath)
        if (state) sendToWindowState(state, 'wharness:notifications:open', record)
      },
      workerState, pauseWorkers, resumeWorkers,
      warn: console.warn,
    })
    setTrayControl(control)
    return control
  }

  function publishDesktopNotification(windowState, request) {
    const projectPath = canonicalProjectPath(request?.projectPath)
    if (!windowState.projects.has(projectPath)) throw new Error('Notification project does not belong to this window')
    return desktopTrayController().publishNotification(completionNotificationRecord(projectPath, request))
  }

  function refreshDesktopTray() {
    getTrayControl()?.refresh()
  }

  function ensureDesktopTray() {
    return desktopTrayController().ensure()
  }

  async function requestFullDesktopQuit() {
    if (isQuitting()) return
    markExplicitDesktopExit()
    persistWindowLayout()
    persistDesktopRecoverySession()
    try { await session.defaultSession.flushStorageData() } catch (error) { console.warn('[windows] renderer storage flush failed', error) }
    app.quit()
  }

  const desktopWindowClose = createDesktopWindowCloseCoordinator({
    publish: (windowState, descriptor) => sendToWindowState(windowState, 'wharness:windows:confirm-close', descriptor),
    fallback: (windowState, descriptor) => nativeWindowCloseChoice(dialog, windowState.window, descriptor),
    background: (windowState) => {
      hideAgentInteractionsForWindow(windowState)
      windowState.window.hide()
      ensureDesktopTray()
    },
    closeWindow: (windowState) => windowState.window.destroy(),
    closeAll: () => setTimeout(() => { void requestFullDesktopQuit() }, 0),
  })

  return {
    desktopTrayController, publishDesktopNotification, refreshDesktopTray,
    ensureDesktopTray, requestFullDesktopQuit, desktopWindowClose,
  }
}

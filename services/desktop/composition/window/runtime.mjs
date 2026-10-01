import {
  createProjectWindowOwnership, createDesktopWindowRecovery,
  createDesktopProjectNavigation, createDesktopWindowLayout,
  createDesktopRestartIntent, createDesktopCoordinatorRelaunch,
} from '../../window/index.mjs'
import { createDesktopTrayComposition } from './tray-lifecycle.mjs'
import { createBrowserMonitorOpener } from '../../window/lifecycle/browser-monitor.mjs'

export function createDesktopWindowRuntime(d) {
  const {
    acquireProjectForWindow, suspendNativeSurfacesForWindow,
    releaseProjectForWindow, releaseWindowProjects,
  } = createProjectWindowOwnership({
    registry: d.projectWindowRegistry, windows: d.desktopWindows,
    canonicalProjectPath: d.canonicalProjectPath,
    windowTitle: (projectPath) => d.desktopWindowTitle(projectPath, d.DESKTOP_INSTANCE),
    refreshTray: d.refreshDesktopTray, trayControl: d.getTrayControl,
    activeChatGPTEntry: d.activeChatGPTEntry,
    deferredNavigation: d.getDeferredSupervisorNavigation,
    reconcileThrottle: d.reconcileChatGPTThrottle,
    chatGPTKeyForEntry: d.chatGPTKeyForEntry,
    hideAgentInteractions: d.hideAgentInteractionsForWindow,
  })

  const desktopWindowRecovery = createDesktopWindowRecovery({
    userDataPath: d.userDataPath, windows: d.desktopWindows,
    canonicalProjectPath: d.canonicalProjectPath,
  })
  const persistDesktopRecoverySession = desktopWindowRecovery.persist
  const consumeDesktopRecoverySession = desktopWindowRecovery.consume

  const {
    projectMenuLabel, projectWindowState, restoreProjectWindow,
    requestProjectClose, activeDesktopProjects, showDesktopFallbackWindow,
    sendDesktopTrayProjectAction,
  } = createDesktopProjectNavigation({
    windows: d.desktopWindows, sendToWindowState: d.sendToWindowState,
    createWindow: d.createWindow, setMainWindow: d.setMainWindow,
  })

  const openBrowserMonitor = createBrowserMonitorOpener(d.desktopWindows, d.createWindow)

  const {
    desktopTrayController, publishDesktopNotification, refreshDesktopTray,
    ensureDesktopTray, requestFullDesktopQuit, desktopWindowClose,
  } = createDesktopTrayComposition({
    app: d.app, dialog: d.dialog, Menu: d.Menu, Notification: d.Notification,
    Tray: d.Tray, nativeImage: d.nativeImage, session: d.session,
    icon: d.DESKTOP_ICON, instanceName: d.desktopInstanceName(d.DESKTOP_INSTANCE),
    platform: d.platform, getTrayControl: d.getTrayControl,
    setTrayControl: d.setTrayControl, listProjects: activeDesktopProjects,
    projectLabel: projectMenuLabel, restoreProject: restoreProjectWindow,
    closeProject: requestProjectClose, showFallback: showDesktopFallbackWindow, openBrowserMonitor,
    sendProjectAction: sendDesktopTrayProjectAction, projectWindowState,
    sendToWindowState: d.sendToWindowState, workerState: d.chatAgentRuntimeState,
    pauseWorkers: d.pauseChatAgentWorkers, resumeWorkers: d.resumeChatAgentWorkers,
    canonicalProjectPath: d.canonicalProjectPath,
    hideAgentInteractionsForWindow: d.hideAgentInteractionsForWindow,
    persistWindowLayout: d.persistWindowLayout,
    persistDesktopRecoverySession,
    markExplicitDesktopExit: d.markExplicitDesktopExit,
    isQuitting: d.isQuitting,
  })

  // The cache marker is initialized between tray setup and window layout.
  const chatGPTCacheMarker = d.createChatGPTCacheMarker({
    userDataPath: d.userDataPath, chromiumVersion: d.CHATGPT_CHROMIUM_VERSION,
  })

  const desktopWindowLayout = createDesktopWindowLayout({
    userDataPath: d.userDataPath, windows: d.desktopWindows,
    displays: d.displays,
  })
  const persistWindowLayout = desktopWindowLayout.persist
  const scheduleWindowLayoutPersistence = desktopWindowLayout.schedulePersistence
  const loadWindowLayout = desktopWindowLayout.loadWindowLayout
  const loadWindowPlacement = desktopWindowLayout.loadWindowPlacement

  const desktopRestartIntent = createDesktopRestartIntent({ userDataPath: d.userDataPath })
  const persistRestartIntent = desktopRestartIntent.persist
  const consumeRestartIntent = desktopRestartIntent.consume

  const { waitForSelfEvolutionActivation, scheduleDesktopCoordinatorRelaunch } =
    createDesktopCoordinatorRelaunch({ isQuitting: d.isQuitting })

  return {
    acquireProjectForWindow, suspendNativeSurfacesForWindow,
    releaseProjectForWindow, releaseWindowProjects,
    desktopWindowRecovery, persistDesktopRecoverySession, consumeDesktopRecoverySession,
    projectMenuLabel, projectWindowState, restoreProjectWindow,
    requestProjectClose, activeDesktopProjects, showDesktopFallbackWindow,
    sendDesktopTrayProjectAction, desktopTrayController,
    publishDesktopNotification, refreshDesktopTray, ensureDesktopTray,
    requestFullDesktopQuit, desktopWindowClose, chatGPTCacheMarker,
    desktopWindowLayout, persistWindowLayout, scheduleWindowLayoutPersistence,
    loadWindowLayout, loadWindowPlacement, desktopRestartIntent,
    persistRestartIntent, consumeRestartIntent, waitForSelfEvolutionActivation,
    scheduleDesktopCoordinatorRelaunch,
  }
}

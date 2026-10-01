import { createDesktopWindowRuntime } from '../runtime.mjs'

export function createDesktopWindowAssembly(deps) {
  const {
    app, dialog, Menu, Notification, Tray, nativeImage,
    session, DESKTOP_ICON, DESKTOP_INSTANCE, desktopInstanceName, desktopWindowTitle, desktopWindows,
    projectWindowRegistry, canonicalProjectPath, activeChatGPTEntry, reconcileChatGPTThrottle, chatGPTKeyForEntry, sendToWindowState,
    chatAgentRuntimeState, resumeChatAgentWorkers, createChatGPTCacheMarker, CHATGPT_CHROMIUM_VERSION,
  } = deps

  const {
    acquireProjectForWindow, suspendNativeSurfacesForWindow,
    releaseProjectForWindow, releaseWindowProjects,
    persistDesktopRecoverySession, consumeDesktopRecoverySession,
    projectMenuLabel, projectWindowState, restoreProjectWindow, requestProjectClose,
    activeDesktopProjects, showDesktopFallbackWindow, sendDesktopTrayProjectAction,
    desktopTrayController, publishDesktopNotification, refreshDesktopTray,
    ensureDesktopTray, requestFullDesktopQuit, desktopWindowClose,
    chatGPTCacheMarker, persistWindowLayout, scheduleWindowLayoutPersistence,
    loadWindowLayout, loadWindowPlacement, persistRestartIntent, consumeRestartIntent,
    waitForSelfEvolutionActivation, scheduleDesktopCoordinatorRelaunch,
  } = createDesktopWindowRuntime({
    app, dialog, Menu, Notification, Tray, nativeImage, session, DESKTOP_ICON,
    platform: deps.platform, DESKTOP_INSTANCE, desktopInstanceName, desktopWindowTitle,
    desktopWindows, projectWindowRegistry, canonicalProjectPath,
    activeChatGPTEntry, reconcileChatGPTThrottle, chatGPTKeyForEntry,
    sendToWindowState, chatAgentRuntimeState, resumeChatAgentWorkers,
    createChatGPTCacheMarker, CHATGPT_CHROMIUM_VERSION,
    pauseChatAgentWorkers: deps.pauseChatAgentWorkers,
    userDataPath: deps.userDataPath, displays: deps.displays,
    getTrayControl: deps.getTrayControl,
    setTrayControl: deps.setTrayControl,
    setMainWindow: deps.setMainWindow,
    getDeferredSupervisorNavigation: deps.getDeferredSupervisorNavigation,
    refreshDesktopTray: deps.refreshDesktopTray,
    createWindow: deps.createWindow,
    hideAgentInteractionsForWindow: deps.hideAgentInteractionsForWindow,
    persistWindowLayout: deps.persistWindowLayout,
    markExplicitDesktopExit: deps.markExplicitDesktopExit,
    isQuitting: deps.isQuitting,
  })

  return {
    acquireProjectForWindow, suspendNativeSurfacesForWindow, releaseProjectForWindow,
    releaseWindowProjects, persistDesktopRecoverySession, consumeDesktopRecoverySession,
    projectMenuLabel, projectWindowState, restoreProjectWindow, requestProjectClose,
    activeDesktopProjects, showDesktopFallbackWindow, sendDesktopTrayProjectAction,
    desktopTrayController, publishDesktopNotification, refreshDesktopTray,
    ensureDesktopTray, requestFullDesktopQuit, desktopWindowClose, chatGPTCacheMarker,
    persistWindowLayout, scheduleWindowLayoutPersistence, loadWindowLayout,
    loadWindowPlacement, persistRestartIntent, consumeRestartIntent,
    waitForSelfEvolutionActivation, scheduleDesktopCoordinatorRelaunch,
  }
}

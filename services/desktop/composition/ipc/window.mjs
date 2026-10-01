export function registerWindowDomainIPC(common, context) {
  const { ipcMain, trustedSender } = common
  const {
    registerWindowIPC, registerDesktopShellIPC, registerSpellcheckIPC, desktopWindows,
    acquireProjectForWindow, releaseProjectForWindow, suspendNativeSurfacesForWindow, createWindow,
    normalizedWorkspaceSurface, desktopWindowAtScreenPoint, sendToWindowState, desktopWindowClose,
    DESKTOP_INSTANCE, publishDesktopNotification, canonicalProjectPath, desktopTrayController,
    persistWindowLayout, persistRestartIntent, waitForSelfEvolutionActivation, scheduleDesktopCoordinatorRelaunch,
    app,
  } = context
  registerWindowIPC({
    ipcMain, trustedSender, desktopWindows, acquireProjectForWindow,
    releaseProjectForWindow, suspendNativeSurfacesForWindow, createWindow,
    normalizedWorkspaceSurface, desktopWindowAtScreenPoint, sendToWindowState,
    desktopWindowClose, DESKTOP_INSTANCE,
  })
  registerDesktopShellIPC({
    ipcMain, trustedSender, publishDesktopNotification, canonicalProjectPath,
    desktopTrayController, persistWindowLayout, persistRestartIntent,
    desktopWindows, sendToWindowState, waitForSelfEvolutionActivation,
    scheduleDesktopCoordinatorRelaunch, app,
  })
  registerSpellcheckIPC({ ipcMain, trustedSender })
}

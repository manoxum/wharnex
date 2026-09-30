import { createDesktopWindowCreator, createWorkspaceSurfaceRouting } from '../../window/index.mjs'

export function createDesktopWindowCreationRuntime(d) {
  const createWindow = createDesktopWindowCreator({
    BrowserWindow: d.BrowserWindow, Menu: d.Menu, shell: d.shell,
    randomUUID: d.randomUUID, path: d.path, here: d.here,
    canonicalProjectPath: d.canonicalProjectPath,
    loadWindowPlacement: d.loadWindowPlacement,
    MIN_DESKTOP_WINDOW_SIZE: d.MIN_DESKTOP_WINDOW_SIZE,
    desktopWindowTitle: d.desktopWindowTitle,
    DESKTOP_INSTANCE: d.DESKTOP_INSTANCE, DESKTOP_ICON: d.DESKTOP_ICON,
    securePreferences: d.securePreferences,
    desktopWindows: d.desktopWindows,
    setMainWindow: d.setMainWindow, getMainWindow: d.getMainWindow,
    isQuitting: d.isQuitting, FRONTEND_URL: d.FRONTEND_URL,
    FRONTEND_RUNTIME_TOKEN: d.FRONTEND_RUNTIME_TOKEN,
    FRONTEND_ORIGIN: d.FRONTEND_ORIGIN,
    installNativeSurfaceLifecycleGuard: d.installNativeSurfaceLifecycleGuard,
    suspendNativeSurfacesForWindow: d.suspendNativeSurfacesForWindow,
    spellcheckContextMenuTemplate: d.spellcheckContextMenuTemplate,
    FRONTEND_RENDERER_RESTART_LIMIT: d.FRONTEND_RENDERER_RESTART_LIMIT,
    publishChatGPTState: d.publishChatGPTState,
    scheduleWindowLayoutPersistence: d.scheduleWindowLayoutPersistence,
    desktopWindowClose: d.desktopWindowClose,
    hideChatAgentInteractionsForWindow: d.hideChatAgentInteractionsForWindow,
    rehomeChatGPTWorkers: d.rehomeChatGPTWorkers,
    closeInternalChatGPTBrowserForWindow: d.closeInternalChatGPTBrowserForWindow,
    closeChatGPTViewsForWindow: d.closeChatGPTViewsForWindow,
    releaseWindowProjects: d.releaseWindowProjects,
    persistWindowLayout: d.persistWindowLayout,
    refreshDesktopTray: d.refreshDesktopTray, isHTTPS: d.isHTTPS,
  })

  const { normalizedWorkspaceSurface, desktopWindowAtScreenPoint } = createWorkspaceSurfaceRouting({
    canonicalProjectPath: d.canonicalProjectPath,
    windows: d.desktopWindows,
    getFocusedWindow: d.getFocusedWindow,
  })

  return { createWindow, normalizedWorkspaceSurface, desktopWindowAtScreenPoint }
}

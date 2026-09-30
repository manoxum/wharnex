import { installLocalEditorContextMenu } from './editor-menu.mjs'

export function createDesktopWindowCreator({
  BrowserWindow, Menu, shell, randomUUID, path, here,
  canonicalProjectPath, loadWindowPlacement, MIN_DESKTOP_WINDOW_SIZE,
  desktopWindowTitle, DESKTOP_INSTANCE, DESKTOP_ICON, securePreferences,
  desktopWindows, setMainWindow, getMainWindow, isQuitting,
  FRONTEND_URL, FRONTEND_RUNTIME_TOKEN, FRONTEND_ORIGIN,
  installNativeSurfaceLifecycleGuard, suspendNativeSurfacesForWindow,
  spellcheckContextMenuTemplate, FRONTEND_RENDERER_RESTART_LIMIT,
  publishChatGPTState, scheduleWindowLayoutPersistence,
  desktopWindowClose, hideChatAgentInteractionsForWindow,
  rehomeChatGPTWorkers, closeInternalChatGPTBrowserForWindow,
  closeChatGPTViewsForWindow, releaseWindowProjects,
  persistWindowLayout, refreshDesktopTray, isHTTPS,
}) {
  function createWindow(windowId = `window-${randomUUID()}`, persistLayout = true, launch = {}) {
    const id = /^[A-Za-z0-9_-]{1,80}$/.test(String(windowId || '')) ? String(windowId) : `window-${randomUUID()}`
    const surface = launch?.surface && typeof launch.surface === 'object' ? launch.surface : undefined
    const recovery = launch?.recovery && typeof launch.recovery === 'object' ? {
      active: true,
      projects: Array.isArray(launch.recovery.projects) ? launch.recovery.projects.map(canonicalProjectPath) : [],
      activeProject: typeof launch.recovery.activeProject === 'string' && launch.recovery.activeProject.trim() ? canonicalProjectPath(launch.recovery.activeProject) : '',
      // The renderer still owes a decision on this session.
      pending: Boolean(launch.recovery.pending),
    } : undefined
    const initialWindowPlacement = surface ? { width: 1280, height: 820, maximized: false } : loadWindowPlacement(id)
    const win = new BrowserWindow({
      width: initialWindowPlacement.width,
      height: initialWindowPlacement.height,
      ...(Number.isFinite(initialWindowPlacement.x) && Number.isFinite(initialWindowPlacement.y) ? { x: initialWindowPlacement.x, y: initialWindowPlacement.y } : {}),
      minWidth: surface ? 760 : MIN_DESKTOP_WINDOW_SIZE.width,
      minHeight: surface ? 520 : MIN_DESKTOP_WINDOW_SIZE.height,
      title: desktopWindowTitle('', DESKTOP_INSTANCE),
      icon: DESKTOP_ICON,
      name: `wharness-${id}`,
      backgroundColor: '#eceee7',
      autoHideMenuBar: true,
      // The themed shell owns every visible pixel of window chrome, including
      // minimize, maximize and close. This keeps the controls consistent with
      // the selected Wharnex theme instead of mixing native window buttons into
      // the project header.
      frame: false,
      webPreferences: securePreferences({ preload: path.join(here, 'preload.cjs') }),
    })
    const state = { id, window: win, projects: new Set(), activeProject: '', activeChatGPTKey: '', chatgptVisible: false, chatgptBounds: undefined, activeAgentInteractionId: '', transientSurface: Boolean(surface), recovery }
    if (surface?.projectPath) {
      state.projects.add(surface.projectPath)
      state.activeProject = surface.projectPath
      win.setTitle(desktopWindowTitle(surface.projectPath, DESKTOP_INSTANCE))
    }
    desktopWindows.set(id, state)
    setMainWindow(win)
    if (!surface && initialWindowPlacement.maximized) win.maximize()

    const target = new URL(FRONTEND_URL)
    target.searchParams.set('wharnessWindow', id)
    target.searchParams.set('wharnessRuntime', FRONTEND_RUNTIME_TOKEN)
    if (surface) {
      target.searchParams.set('embedded', '1')
      target.searchParams.set('active', '1')
      target.searchParams.set('project', surface.projectPath)
      target.searchParams.set('surface', surface.kind)
      target.searchParams.set('surfaceHost', 'window')
      if (surface.chatId) target.searchParams.set('chat', surface.chatId)
      if (surface.path) target.searchParams.set('path', surface.path)
    }

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isHTTPS(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      try { if (new URL(url).origin !== FRONTEND_ORIGIN) event.preventDefault() }
      catch { event.preventDefault() }
    })
    installNativeSurfaceLifecycleGuard(win.webContents, { frontendOrigin: FRONTEND_ORIGIN, suspend: () => suspendNativeSurfacesForWindow(state) }); installLocalEditorContextMenu(win, { Menu, spellcheckContextMenuTemplate })
    // The trusted local frontend renderer previously had no crash recovery at
    // all: a GPU/OOM-triggered renderer death left a permanently blank window
    // with no diagnostic trace, indistinguishable from the whole app crashing.
    // Renderer-crash recovery is deliberately paced and bounded.
    //
    // Reloading the instant the process dies can re-enter the same failure: a
    // loadURL issued while a previous sandboxed renderer spawn is still settling
    // is one of the ways Electron produces "Cannot destructure property
    // 'preloadScripts' of 'binding.startupData'", so an immediate retry can turn
    // a single crash into a reload loop. Back off, and stop retrying rather than
    // thrash — a window that will not come back needs a human, not another spin.
    state.rendererRestarts = 0
    state.rendererRestartTimer = undefined
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[frontend-renderer] window=${id} gone reason=${details.reason} exitCode=${details.exitCode} restarts=${state.rendererRestarts}`)
      if (isQuitting() || details.reason === 'clean-exit') return
      if (state.rendererRestarts >= FRONTEND_RENDERER_RESTART_LIMIT) {
        console.error(`[frontend-renderer] window=${id} exceeded ${FRONTEND_RENDERER_RESTART_LIMIT} restarts; leaving it stopped for human attention`)
        return
      }
      state.rendererRestarts += 1
      const delay = Math.min(8_000, 500 * (2 ** (state.rendererRestarts - 1)))
      clearTimeout(state.rendererRestartTimer)
      state.rendererRestartTimer = setTimeout(() => {
        if (isQuitting() || win.isDestroyed()) return
        void win.loadURL(target.href).catch((error) => console.error(`[frontend-renderer] reload failed window=${id} error=${error?.message || 'unknown'}`))
      }, delay)
    })
    // A renderer that stays up long enough to be usable clears the crash budget,
    // so an unrelated crash weeks later still gets its full allowance.
    win.webContents.on('did-finish-load', () => {
      clearTimeout(state.rendererRestartHealthyTimer)
      state.rendererRestartHealthyTimer = setTimeout(() => { state.rendererRestarts = 0 }, 30_000)
    })
    win.webContents.on('unresponsive', () => console.error(`[frontend-renderer] window=${id} unresponsive`))
    win.webContents.on('responsive', () => console.log(`[frontend-renderer] window=${id} responsive`))
    win.on('focus', () => { setMainWindow(win); win.flashFrame(false); publishChatGPTState(state.activeChatGPTKey) })
    win.on('blur', () => publishChatGPTState(state.activeChatGPTKey))
    if (!state.transientSurface) {
      win.on('resize', scheduleWindowLayoutPersistence)
      win.on('move', scheduleWindowLayoutPersistence)
      win.on('maximize', scheduleWindowLayoutPersistence)
      win.on('unmaximize', scheduleWindowLayoutPersistence)
    }
    win.on('close', (event) => {
      if (!isQuitting() && !state.transientSurface && desktopWindowClose.request(state, event)) return
      hideChatAgentInteractionsForWindow(state)
      if (!isQuitting()) rehomeChatGPTWorkers(state)
    })
    win.on('closed', () => {
      desktopWindowClose.clear(state)
      closeInternalChatGPTBrowserForWindow(state)
      closeChatGPTViewsForWindow(state)
      releaseWindowProjects(state)
      desktopWindows.delete(id)
      if (getMainWindow() === win) setMainWindow(BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0])
      if (!isQuitting() && !state.transientSurface) persistWindowLayout()
      refreshDesktopTray()
    })

    void win.loadURL(target.href)
    if (!isQuitting() && persistLayout) persistWindowLayout()
    return state
  }
  return createWindow
}

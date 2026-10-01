import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createDesktopWindowCreator } from './index.mjs'

function fixture() {
  const events = []
  const desktopWindows = new Map()
  let mainWindow
  let quitting = false
  class FakeWindow extends EventEmitter {
    static all = []
    static getFocusedWindow() { return undefined }
    static getAllWindows() { return FakeWindow.all.filter((win) => !win.destroyed) }
    constructor(options) {
      super()
      this.options = options
      this.webContents = new EventEmitter()
      this.webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler }
      this.webContents.replaceMisspelling = () => {}
      this.webContents.session = { addWordToSpellCheckerDictionary() {} }
      FakeWindow.all.push(this)
      events.push('construct')
    }
    setTitle(title) { this.title = title }
    loadURL(url) { this.url = url; events.push('load'); return Promise.resolve() }
    isDestroyed() { return Boolean(this.destroyed) }
    maximize() { events.push('maximize') }
    flashFrame() {}
  }
  const createWindow = createDesktopWindowCreator({
    BrowserWindow: FakeWindow, Menu: { buildFromTemplate: () => ({ popup() {} }) },
    shell: { openExternal() {} }, randomUUID: () => 'generated', path: { join: (...parts) => parts.join('/') }, here: '/desktop',
    canonicalProjectPath: (value) => value, loadWindowPlacement: () => ({ width: 900, height: 600, maximized: true }),
    MIN_DESKTOP_WINDOW_SIZE: { width: 800, height: 500 }, desktopWindowTitle: (project) => `title:${project}`,
    DESKTOP_INSTANCE: 'test', DESKTOP_ICON: {}, securePreferences: (preferences) => preferences,
    desktopWindows, setMainWindow: (win) => { mainWindow = win }, getMainWindow: () => mainWindow,
    isQuitting: () => quitting, FRONTEND_URL: 'http://127.0.0.1:5173/', FRONTEND_RUNTIME_TOKEN: 'runtime',
    FRONTEND_ORIGIN: 'http://127.0.0.1:5173', installNativeSurfaceLifecycleGuard: () => events.push('guard'),
    suspendNativeSurfacesForWindow: () => {}, spellcheckContextMenuTemplate: () => [],
    FRONTEND_RENDERER_RESTART_LIMIT: 5, publishChatGPTState: () => {},
    scheduleWindowLayoutPersistence: () => events.push('schedule-layout'),
    desktopWindowClose: { request: () => false, clear: () => events.push('clear-close') },
    hideChatAgentInteractionsForWindow: () => events.push('hide-interactions'),
    rehomeChatGPTWorkers: () => events.push('rehome-workers'),
    closeInternalChatGPTBrowserForWindow: () => events.push('close-internal-browser'),
    closeChatGPTViewsForWindow: () => events.push('close-views'),
    releaseWindowProjects: () => events.push('release-projects'),
    persistWindowLayout: () => events.push('persist-layout'),
    refreshDesktopTray: () => events.push('refresh-tray'), isHTTPS: (url) => url.startsWith('https://'),
  })
  return { createWindow, events, desktopWindows, setQuitting: (value) => { quitting = value }, getMainWindow: () => mainWindow }
}

test('created window loads the scoped local frontend after guards and persists its placement', () => {
  const { createWindow, events, desktopWindows, getMainWindow } = fixture()
  const state = createWindow('primary')
  assert.equal(state.id, 'primary')
  assert.equal(desktopWindows.get('primary'), state)
  assert.equal(getMainWindow(), state.window)
  assert.equal(state.window.options.frame, false)
  assert.equal(state.window.options.webPreferences.preload, '/desktop/preload.cjs')
  assert.deepEqual(events, ['construct', 'maximize', 'guard', 'load', 'persist-layout'])
  const url = new URL(state.window.url)
  assert.equal(url.searchParams.get('wharnessWindow'), 'primary')
  assert.equal(url.searchParams.get('wharnessRuntime'), 'runtime')
  assert.equal(state.window.openHandler({ url: 'http://external.test/' }).action, 'deny')
  let blocked = false
  state.window.webContents.emit('will-navigate', { preventDefault() { blocked = true } }, 'https://external.test/')
  assert.equal(blocked, true)
})

test('close uses current quit state and releases owned resources in order', () => {
  const { createWindow, events, desktopWindows, setQuitting, getMainWindow } = fixture()
  const state = createWindow('primary')
  events.length = 0
  state.window.emit('close', {})
  assert.deepEqual(events, ['hide-interactions', 'rehome-workers'])
  setQuitting(true)
  state.window.destroyed = true
  state.window.emit('closed')
  assert.deepEqual(events, [
    'hide-interactions', 'rehome-workers', 'clear-close', 'close-internal-browser',
    'close-views', 'release-projects', 'refresh-tray',
  ])
  assert.equal(desktopWindows.size, 0)
  assert.equal(getMainWindow(), undefined)
})

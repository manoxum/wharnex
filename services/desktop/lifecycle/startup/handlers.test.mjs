import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerDesktopLifecycleHandlers } from './index.mjs'

test('shutdown saves recovery before stopping poller and all schedulers', () => {
  const app = new EventEmitter()
  const events = []
  let quitting = false
  const poller = setInterval(() => {}, 1000)
  registerDesktopLifecycleHandlers({
    app, desktopWindows: new Map(),
    persistDesktopRecoverySession: () => events.push('recovery'),
    persistWindowLayout: () => events.push('layout'),
    ensureDesktopTray: () => events.push('tray'),
    getExplicitDesktopExit: () => false,
    getQuitting: () => quitting, setQuitting: (value) => { quitting = value; events.push('quitting') },
    getDownloadPoller: () => poller,
    getDesktopTrayControl: () => ({ destroy: () => events.push('destroy-tray') }),
    getWorkerScheduler: () => ({ stop: () => events.push('stop-worker') }),
    getTranslatorScheduler: () => ({ stop: () => events.push('stop-translator') }),
    getSupervisorScheduler: () => ({ stop: () => events.push('stop-supervisor') }),
    createWindow: () => events.push('create-window'),
  })
  app.emit('window-all-closed')
  app.emit('before-quit')
  app.emit('window-all-closed')
  assert.deepEqual(events, [
    'tray', 'recovery', 'quitting', 'layout', 'destroy-tray',
    'stop-worker', 'stop-translator', 'stop-supervisor',
  ])
  assert.equal(poller._destroyed, true)
})

test('activate focuses a live main window and creates one only when none exists', () => {
  const app = new EventEmitter()
  const events = []
  const windows = new Map([['transient', { transientSurface: true, window: { isDestroyed: () => false } }]])
  registerDesktopLifecycleHandlers({
    app, desktopWindows: windows, persistDesktopRecoverySession: () => {},
    persistWindowLayout: () => {}, ensureDesktopTray: () => {},
    getExplicitDesktopExit: () => true, getQuitting: () => false, setQuitting: () => {},
    getDownloadPoller: () => undefined, getDesktopTrayControl: () => undefined,
    getWorkerScheduler: () => undefined, getTranslatorScheduler: () => undefined,
    getSupervisorScheduler: () => undefined,
    createWindow: (name) => events.push(`create:${name}`),
  })
  app.emit('activate')
  windows.set('main', { window: {
    isDestroyed: () => false,
    show: () => events.push('show'),
    focus: () => events.push('focus'),
  } })
  app.emit('activate')
  assert.deepEqual(events, ['create:primary', 'show', 'focus'])
})

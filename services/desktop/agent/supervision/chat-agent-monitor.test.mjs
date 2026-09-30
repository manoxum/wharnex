import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { closeWorkerMonitor, closeWorkerMonitorAfterState, openWorkerMonitor, WORKER_MONITOR_VIEWPORT } from './chat-agent-monitor.mjs'

class FakeBrowserWindow extends EventEmitter {
  static windows = []
  constructor(options) {
    super()
    this.options = options
    this.destroyed = false
    this.children = []
    this.contentView = {
      addChildView: (view) => this.children.push(view),
      removeChildView: (view) => { this.children = this.children.filter((child) => child !== view) },
    }
    FakeBrowserWindow.windows.push(this)
  }
  isDestroyed() { return this.destroyed }
  show() { this.shown = true }
  close() { this.emit('close'); this.destroyed = true }
}

function worker(slotId = 'worker-1') {
  const bounds = []
  const visibility = []
  const view = {
    webContents: { isDestroyed: () => false },
    setBounds: (value) => bounds.push(value),
    setVisible: (value) => visibility.push(value),
  }
  return { entry: { slotId, view, interactionWindowId: '', parkedLayout: true }, bounds, visibility, view }
}

test('monitor shows the existing Worker at its 1280×900 automation viewport', () => {
  FakeBrowserWindow.windows = []
  const { entry, bounds, visibility, view } = worker()
  const result = openWorkerMonitor(entry, FakeBrowserWindow)
  assert.deepEqual(result, { ok: true, agentId: 'worker-1', alreadyOpen: false })
  const window = FakeBrowserWindow.windows[0]
  assert.equal(window.options.useContentSize, true)
  assert.equal(window.options.resizable, false)
  assert.equal(window.options.webPreferences.nodeIntegration, false)
  assert.deepEqual(bounds, [WORKER_MONITOR_VIEWPORT])
  assert.deepEqual(visibility, [true])
  assert.deepEqual(window.children, [view])
  assert.equal(entry.parkedLayout, false)
  assert.equal(openWorkerMonitor(entry, FakeBrowserWindow).alreadyOpen, true)
  assert.equal(FakeBrowserWindow.windows.length, 1)
})

test('different Workers keep independent monitor windows', () => {
  FakeBrowserWindow.windows = []
  const first = worker('worker-1')
  const second = worker('worker-2')
  openWorkerMonitor(first.entry, FakeBrowserWindow)
  openWorkerMonitor(second.entry, FakeBrowserWindow)
  const [firstWindow, secondWindow] = FakeBrowserWindow.windows

  assert.equal(FakeBrowserWindow.windows.length, 2)
  assert.notEqual(first.entry.monitorWindow, second.entry.monitorWindow)
  assert.deepEqual(firstWindow.children, [first.view])
  assert.deepEqual(secondWindow.children, [second.view])
  assert.equal(openWorkerMonitor(first.entry, FakeBrowserWindow).alreadyOpen, true)
  assert.equal(FakeBrowserWindow.windows.length, 2)

  closeWorkerMonitor(first.entry)
  assert.equal(first.entry.monitorWindow, undefined)
  assert.equal(first.entry.parkedLayout, true)
  assert.deepEqual(firstWindow.children, [])
  assert.equal(second.entry.monitorWindow, secondWindow)
  assert.equal(secondWindow.destroyed, false)
  assert.equal(second.entry.parkedLayout, false)
  assert.deepEqual(secondWindow.children, [second.view])
  assert.deepEqual(second.visibility, [true])
})

test('closing the monitor detaches without destroying or navigating the Worker', () => {
  const { entry, bounds, visibility } = worker()
  let closed = 0
  openWorkerMonitor(entry, FakeBrowserWindow, () => { closed += 1 })
  const result = closeWorkerMonitor(entry)
  assert.equal(result.closed, true)
  assert.equal(closed, 1)
  assert.equal(entry.monitorWindow, undefined)
  assert.equal(entry.parkedLayout, true)
  assert.deepEqual(visibility, [true, false])
  assert.deepEqual(bounds, [WORKER_MONITOR_VIEWPORT, WORKER_MONITOR_VIEWPORT])
  assert.equal(closeWorkerMonitor(entry).closed, false)
})

test('direct interaction and monitoring cannot own the same Worker view', () => {
  const { entry } = worker()
  entry.interactionWindowId = 'window-1'
  assert.throws(() => openWorkerMonitor(entry, FakeBrowserWindow), /Feche a interação direta/)
})

test('a settled Worker task closes its follow window and returns the view to parking', () => {
  const { entry } = worker()
  openWorkerMonitor(entry, FakeBrowserWindow)
  closeWorkerMonitorAfterState(entry, 'running')
  assert.ok(entry.monitorWindow)
  closeWorkerMonitorAfterState(entry, 'settled')
  assert.equal(entry.monitorWindow, undefined)
  assert.equal(entry.parkedLayout, true)
})

test('monitor IPC remains a trusted, named Worker-only bridge', async () => {
  const main = await readFile(new URL('../../main.mjs', import.meta.url), 'utf8')
  const surfaceIPC = await readFile(new URL('../ipc/surfaces.mjs', import.meta.url), 'utf8')
  const preload = await readFile(new URL('../../preload.cjs', import.meta.url), 'utf8')
  const open = surfaceIPC.slice(surfaceIPC.indexOf("ipcMain.handle('wharness:agents:monitor-open'"), surfaceIPC.indexOf("ipcMain.handle('wharness:agents:monitor-close'"))
  assert.match(main, /registerAgentIPC\(\{/)
  assert.match(open, /trustedSender\(event\)/)
  assert.match(open, /const entry = workerEntryForAgentID\(request\?\.agentId\)/)
  assert.match(open, /if \(entry\.interactionWindowId\) hideChatAgentInteractionEntry\(entry\)/)
  assert.match(open, /openWorkerMonitor\(entry, BrowserWindow, publishChatAgentRuntimeState\)/)
  assert.match(open, /publishChatAgentRuntimeState\(\)/)
  assert.match(surfaceIPC, /ipcMain\.handle\('wharness:agents:monitor-close', \(event, request\) => \{\s*trustedSender\(event\)\s*return closeWorkerMonitor\(workerEntryForAgentID\(request\?\.agentId\)\)/)
  assert.match(preload, /openMonitor: \(agentId\) => invoke\('wharness:agents:monitor-open'/)
  assert.match(preload, /closeMonitor: \(agentId\) => invoke\('wharness:agents:monitor-close'/)
})

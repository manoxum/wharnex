import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserMonitorPresentation } from './browser-monitor-presentation.mjs'

function fixture() {
  const events = []
  const surface = (name) => {
    let zoom = 1
    return {
      webContents: {
        isDestroyed: () => false, getZoomFactor: () => zoom,
        setZoomFactor: (value) => { zoom = value; events.push(`${name}:zoom:${value}`) },
      },
      present: (window, bounds) => events.push(`${name}:present:${window.name}:${bounds.width}x${bounds.height}`),
      resizePresented: (bounds) => events.push(`${name}:resize:${bounds.width}x${bounds.height}`),
      release: () => events.push(`${name}:release`),
    }
  }
  const supervisor = { slotId: 'supervisor-1', role: 'supervisor', ownerKey: 'chat-1', ownerWindowId: 'project', view: surface('supervisor') }
  const worker = { slotId: 'worker-1', role: 'worker', ownerKey: 'task-1', ownerWindowId: 'project', view: surface('worker') }
  const window = (name) => ({ name, isDestroyed: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }) })
  const owner = { id: 'project', window: window('project') }
  const monitor = { id: 'browser-monitor', window: window('monitor') }
  const presentation = createBrowserMonitorPresentation({
    desktopWindows: new Map([['project', owner], ['browser-monitor', monitor]]),
    chatgptViews: new Map([['chat-1', supervisor]]), chatGPTWorkerEntries: [worker],
    normalizeBounds: (bounds) => bounds?.width > 0 && bounds?.height > 0 ? bounds : undefined,
    publishChatAgentRuntimeState: () => events.push('publish-runtime'),
  })
  return { presentation, supervisor, worker, owner, monitor, events }
}

const bounds = { x: 600, y: 120, width: 800, height: 700 }

test('presents the real Supervisor view in the monitor and releases it back to the host', () => {
  const { presentation, supervisor, monitor, events } = fixture()
  assert.deepEqual(presentation.presentBrowserInMonitor('supervisor-1', bounds, monitor), { ok: true, agentId: 'supervisor-1', bounds })
  assert.equal(monitor.activeMonitorAgentEntry, supervisor)
  assert.equal(supervisor.ownerWindowId, 'project')
  assert.ok(events.includes('supervisor:present:monitor:800x700'))
  assert.equal(events.some((event) => event.startsWith('supervisor:zoom')), false)
  presentation.resizeBrowserInMonitor('supervisor-1', { ...bounds, width: 900 }, monitor)
  assert.ok(events.includes('supervisor:resize:900x700'))
  assert.deepEqual(presentation.releaseBrowserMonitor(monitor, 'supervisor-1'), { ok: true, agentId: 'supervisor-1', released: true })
  assert.equal(monitor.activeMonitorAgentEntry, undefined)
  assert.equal(supervisor.monitorWindowId, '')
  assert.ok(events.includes('supervisor:release'))
})

test('a running Worker keeps its automation viewport through zoom and returns on switch', () => {
  const { presentation, worker, monitor, events } = fixture()
  const task = { task_id: 'task-1' }
  worker.task = task
  presentation.presentBrowserInMonitor('worker-1', bounds, monitor)
  assert.equal(worker.task, task)
  assert.equal(worker.view.webContents.getZoomFactor(), 0.625)
  assert.equal(worker.monitorWindowId, 'browser-monitor')
  assert.deepEqual(presentation.releaseBrowserMonitor(monitor, 'supervisor-1'), { ok: true, agentId: 'supervisor-1', released: false })
  presentation.presentBrowserInMonitor('supervisor-1', bounds, monitor)
  assert.equal(worker.view.webContents.getZoomFactor(), 1)
  assert.equal(worker.monitorWindowId, '')
  assert.ok(events.indexOf('worker:release') < events.indexOf('supervisor:present:monitor:800x700'))
})

test('rejects presentation outside the trusted monitor and invalid agent IDs', () => {
  const { presentation, owner, monitor } = fixture()
  assert.throws(() => presentation.presentBrowserInMonitor('worker-1', bounds, owner), /apenas ao monitor/)
  assert.throws(() => presentation.presentBrowserInMonitor('bad-agent', bounds, monitor), /indisponível/)
  assert.throws(() => presentation.presentBrowserInMonitor('worker-1', { ...bounds, width: 0 }, monitor), /inválida/)
})

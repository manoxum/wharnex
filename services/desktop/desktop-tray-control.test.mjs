import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopTrayControl } from './desktop-tray-control.mjs'

class FakeTray {
  constructor(icon) { this.icon = icon; this.handlers = {} }
  isDestroyed() { return false }
  on(name, handler) { this.handlers[name] = handler }
  setToolTip(value) { this.tooltip = value }
  setContextMenu(menu) { this.menu = menu }
}
class FakeNotification {
  static supported = true
  static shown = []
  static isSupported() { return this.supported }
  constructor(options) { this.options = options; this.handlers = {}; FakeNotification.shown.push(this) }
  on(name, handler) { this.handlers[name] = handler }
  show() { this.visible = true }
}

function harness() {
  const actions = []
  const opens = []
  const deps = {
    Menu: { buildFromTemplate: (template) => template }, Notification: FakeNotification, Tray: FakeTray,
    nativeImage: { createFromDataURL: (dataUrl) => ({ dataUrl }) }, icon: { resize: () => ({ raster: true }) }, instanceName: 'Test',
    listProjects: () => ['/work/alpha'], projectLabel: () => 'alpha', restoreProject: () => true, closeProject: () => true,
    showFallback: () => true, quit: () => true, sendProjectAction: (project, action) => actions.push([project, action]),
    sendNotificationOpen: (project, notice) => opens.push([project, notice.id]), workerState: () => ({ worker_pause: { paused: false }, agents: [{ id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', occupied: true }] }),
    pauseWorkers: () => {}, resumeWorkers: () => {}, warn: () => {},
  }
  return { control: createDesktopTrayControl(deps), actions, opens }
}

test('tray menu exposes project color, execution, workers and tunnels', () => {
  const { control, actions } = harness()
  control.updateProjectState('/work/alpha', { attentionTotal: 2, tunnelCount: 1, canApproveExecution: true, canControlExecution: true, planControl: 'active' })
  const tray = control.ensure()
  assert.deepEqual(tray.icon, { raster: true })
  const project = tray.menu.find((item) => item.label === 'alpha')
  assert.ok(project.icon.dataUrl.includes('data:image/svg+xml'))
  const labels = project.submenu.map((item) => item.label).filter(Boolean)
  assert.ok(labels.includes('Aprovar e executar'))
  assert.ok(labels.includes('Pausar execução'))
  assert.ok(labels.includes('Suspender execução'))
  assert.ok(labels.includes('Gerir Workers'))
  assert.ok(labels.includes('Túneis (1)'))
  project.submenu.find((item) => item.label === 'Pausar execução').click()
  assert.deepEqual(actions.at(-1), ['/work/alpha', 'pause-execution'])
})

test('notifications are deduplicated and click routes back to the project', () => {
  FakeNotification.shown.length = 0
  const { control, opens } = harness()
  control.ensure()
  const notice = { id: 'n1', projectPath: '/work/alpha', chatId: 'chat', title: 'Done', body: 'Finished', kind: 'task-completed', occurredAt: new Date().toISOString() }
  assert.equal(control.publishNotification(notice).duplicate, false)
  assert.equal(control.publishNotification(notice).duplicate, true)
  assert.equal(FakeNotification.shown.length, 1)
  FakeNotification.shown[0].handlers.click()
  assert.deepEqual(opens, [['/work/alpha', 'n1']])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopTrayControl } from './desktop-tray-control.mjs'

class FakeTray {
  constructor(icon) { this.icon = icon; this.handlers = {}; this.menus = 0; this.destroyed = false }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true }
  on(name, handler) { this.handlers[name] = handler }
  setToolTip(value) { this.tooltip = value }
  setContextMenu(menu) { this.menu = menu; this.menus += 1 }
}
class FakeNotification {
  static supported = true
  static shown = []
  static isSupported() { return this.supported }
  constructor(options) { this.options = options; this.handlers = {}; FakeNotification.shown.push(this) }
  on(name, handler) { this.handlers[name] = handler }
  show() { this.visible = true }
}

function harness(overrides = {}) {
  const actions = []
  const opens = []
  const deps = {
    Menu: { buildFromTemplate: (template) => template }, Notification: FakeNotification, Tray: FakeTray,
    nativeImage: { createFromDataURL: (dataUrl) => ({ dataUrl }) }, icon: { resize: () => ({ raster: true }) }, instanceName: 'Test',
    listProjects: () => ['/work/alpha'], projectLabel: () => 'alpha', restoreProject: () => true, closeProject: () => true,
    showFallback: () => true, quit: () => true, sendProjectAction: (project, action) => actions.push([project, action]),
    sendNotificationOpen: (project, notice) => opens.push([project, notice.id]), workerState: () => ({ worker_pause: { paused: false }, agents: [{ id: 'worker-1', label: 'Worker 1', role: 'worker', status: 'running', occupied: true }] }),
    pauseWorkers: () => {}, resumeWorkers: () => {}, warn: () => {}, refreshDelayMs: 0,
    ...overrides,
  }
  return { control: createDesktopTrayControl(deps), actions, opens, deps }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

test('tray menu exposes project color, execution, workers and tunnels', () => {
  const { control, actions } = harness()
  control.updateProjectState('/work/alpha', { attentionTotal: 2, tunnelCount: 1, canApproveExecution: true, canControlExecution: true, planControl: 'active' })
  const tray = control.ensure()
  assert.deepEqual(tray.icon, { raster: true })
  const project = tray.menu.find((item) => item.label === 'alpha')
  // PNG, not SVG: nativeImage decodes PNG and JPEG only, so the SVG data URLs
  // this used to build made every menu glyph an empty image.
  assert.ok(project.icon.dataUrl.startsWith('data:image/png;base64,'))
  assert.ok(Buffer.from(project.icon.dataUrl.split(',')[1], 'base64').subarray(1, 4).toString('ascii') === 'PNG')
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

test('a notification that cannot reach its project stays unread', () => {
  FakeNotification.shown.length = 0
  let restorable = false
  const { control, opens } = harness({ restoreProject: () => restorable })
  const tray = control.ensure()
  control.publishNotification({ id: 'n2', projectPath: '/work/alpha', chatId: 'chat', title: 'Done', body: '', kind: 'task-completed', occurredAt: '' })

  assert.equal(tray.handlers.click(), undefined)
  assert.deepEqual(opens, [])
  restorable = true
  tray.handlers.click()
  assert.deepEqual(opens, [['/work/alpha', 'n2']])
})

test('tray creation failure is reported instead of breaking the caller', () => {
  const warnings = []
  const { control } = harness({
    Tray: class { constructor() { throw new Error('no status area') } },
    warn: (...entry) => warnings.push(entry),
  })
  assert.equal(control.ensure(), undefined)
  assert.equal(warnings.length, 1)
  assert.doesNotThrow(() => control.refresh())
  assert.doesNotThrow(() => control.destroy())
})

test('a failing rebuild is reported and retried instead of escaping the timer', async () => {
  const warnings = []
  let broken = true
  const { control } = harness({
    workerState: () => { if (broken) throw new Error('runtime state unavailable'); return { worker_pause: { paused: false }, agents: [] } },
    warn: (...entry) => warnings.push(entry),
  })
  const tray = control.ensure()
  assert.equal(warnings.length, 1)
  assert.equal(tray.menus, 0)

  broken = false
  control.updateProjectState('/work/alpha', { status: 'Pronto' })
  await settle()
  assert.equal(tray.menus, 1, 'the next state change must rebuild rather than be skipped as rendered')
})

test('menu rebuilds are coalesced and skipped when nothing rendered changed', async () => {
  const { control } = harness()
  const tray = control.ensure()
  control.updateProjectState('/work/alpha', { status: 'Pronto', tunnelCount: 1 })
  await settle()
  const initial = tray.menus

  for (let index = 0; index < 20; index += 1) control.updateProjectState('/work/alpha', { status: 'Pronto', tunnelCount: 1 })
  await settle()
  assert.equal(tray.menus, initial, 'an unchanged state must not rebuild the menu')

  control.updateProjectState('/work/alpha', { status: 'Pronto', tunnelCount: 2 })
  control.updateProjectState('/work/alpha', { status: 'Pronto', tunnelCount: 3 })
  control.updateProjectState('/work/alpha', { status: 'Pronto', tunnelCount: 4 })
  await settle()
  assert.equal(tray.menus, initial + 1, 'a burst of changes must collapse into one rebuild')
  assert.ok(tray.menu.find((item) => item.label === 'alpha').submenu.some((item) => item.label === 'Túneis (4)'))
})

test('closing a project drops its tray state and quitting destroys the tray', async () => {
  let projects = ['/work/alpha']
  const { control } = harness({ listProjects: () => projects })
  const tray = control.ensure()
  control.updateProjectState('/work/alpha', { status: 'Pedido em curso', taskInFlight: true })
  await settle()
  assert.ok(tray.menu.find((item) => item.label === 'alpha').submenu[0].label === 'Pedido em curso')

  projects = []
  control.forgetProject('/work/alpha')
  await settle()
  assert.ok(tray.menu.some((item) => item.label === 'Nenhum projeto aberto'))

  control.destroy()
  assert.equal(tray.destroyed, true)
})

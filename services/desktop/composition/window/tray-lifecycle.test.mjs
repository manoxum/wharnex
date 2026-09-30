import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopTrayComposition } from './tray-lifecycle.mjs'

function compose(events) {
  return createDesktopTrayComposition({
    app: { quit: () => events.push('quit') },
    session: { defaultSession: { flushStorageData: async () => { events.push('flush') } } },
    dialog: {}, Menu: {}, Notification: {}, Tray: class {}, nativeImage: {},
    icon: {}, instanceName: 'test', platform: 'linux',
    getTrayControl: () => undefined, setTrayControl: () => {},
    listProjects: () => [], projectLabel: () => '', restoreProject: () => false,
    closeProject: () => false, showFallback: () => false,
    sendProjectAction: () => false, projectWindowState: () => undefined,
    sendToWindowState: (_state, channel) => events.push(channel),
    workerState: () => ({}), pauseWorkers: () => {}, resumeWorkers: () => {},
    canonicalProjectPath: (value) => value,
    hideAgentInteractionsForWindow: () => events.push('hide-agent'),
    persistWindowLayout: () => events.push('layout'),
    persistDesktopRecoverySession: () => events.push('recovery'),
    markExplicitDesktopExit: () => events.push('exit-intent'),
    isQuitting: () => false,
  })
}

test('tray composition keeps close confirmation in renderer and resolves close-window locally', () => {
  const events = []
  const { desktopWindowClose } = compose(events)
  const windowState = {
    activeProject: '/project', projects: new Set(['/project']),
    window: { destroy: () => events.push('destroy') },
  }
  assert.equal(desktopWindowClose.request(windowState, { preventDefault: () => events.push('prevent') }), true)
  assert.deepEqual(events, ['prevent', 'wharness:windows:confirm-close'])
  assert.deepEqual(desktopWindowClose.acknowledge(windowState), { ok: true })
  assert.deepEqual(desktopWindowClose.resolve(windowState, 'close-window'), { ok: true, action: 'close-window' })
  assert.deepEqual(events, ['prevent', 'wharness:windows:confirm-close', 'destroy'])
})

test('full desktop quit persists layout and recovery before flushing renderer storage', async () => {
  const events = []
  await compose(events).requestFullDesktopQuit()
  assert.deepEqual(events, ['exit-intent', 'layout', 'recovery', 'flush', 'quit'])
})

test('notification remains scoped to projects owned by the window', () => {
  const { publishDesktopNotification } = compose([])
  assert.throws(
    () => publishDesktopNotification({ projects: new Set(['/owned']) }, { projectPath: '/other' }),
    /Notification project does not belong to this window/,
  )
})

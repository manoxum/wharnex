import test from 'node:test'
import assert from 'node:assert/strict'
import { registerDesktopShellIPC } from './ipc.mjs'

test('shell IPC keeps notification, tray and activation behind the owning window', () => {
  const handlers = new Map()
  const updates = []
  const owner = { id: 'window-1', projects: new Set(['/owned']) }
  registerDesktopShellIPC({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    trustedSender: () => owner,
    publishDesktopNotification: (windowState, request) => ({ windowState, request }),
    canonicalProjectPath: (value) => String(value),
    desktopTrayController: () => ({ updateProjectState: (...args) => updates.push(args) }),
    persistWindowLayout: () => {}, persistRestartIntent: () => {},
    desktopWindows: new Map(), sendToWindowState: () => {},
    waitForSelfEvolutionActivation: async () => false,
    scheduleDesktopCoordinatorRelaunch: async () => {}, app: { exit: () => {} },
  })
  const notify = handlers.get('wharness:notifications:publish')
  assert.deepEqual(notify({}, { id: 'n1' }), { windowState: owner, request: { id: 'n1' } })
  const tray = handlers.get('wharness:tray:update-project-state')
  assert.throws(() => tray({}, { projectPath: '/foreign' }), /does not belong/)
  assert.deepEqual(tray({}, { projectPath: '/owned' }), { ok: true })
  assert.deepEqual(updates, [['/owned', { projectPath: '/owned' }]])
  const activate = handlers.get('wharness:windows:activate-self-evolution')
  assert.throws(() => activate({}, { impacts: ['desktop', 'unknown'] }), /Invalid self-evolution activation impact/)
  assert.deepEqual(activate({}, { impacts: [] }), { ok: true, action: 'services' })
})

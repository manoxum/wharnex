import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreDesktopWindowsAtStartup } from './restore.mjs'

function fixture(overrides = {}) {
  const events = []
  const windows = new Map()
  const dependencies = {
    loadWindowLayout: () => ['primary', 'secondary'],
    consumeRestartIntent: () => undefined,
    consumeDesktopRecoverySession: () => undefined,
    recoverableDesktopWindows: (records) => records,
    createWindow: (id, visible, options) => { events.push(['create', id, visible, options]); windows.set(id, true) },
    persistWindowLayout: (ids) => events.push(['persist', ids]),
    windows,
    schedule: (callback, delay) => { events.push(['schedule', delay]); callback() },
    ...overrides,
  }
  return { events, dependencies }
}

test('recovery recreates owned projects synchronously with no pending prompt', () => {
  const records = [{ id: 'secondary', projects: ['/work/a'], activeProject: '/work/a' }]
  const { events, dependencies } = fixture({ consumeDesktopRecoverySession: () => records })
  restoreDesktopWindowsAtStartup(dependencies)
  assert.deepEqual(events, [
    ['create', 'secondary', false, { recovery: { projects: ['/work/a'], activeProject: '/work/a', pending: false } }],
    ['persist', ['secondary']],
  ])
})

test('current-window restart recreates requester before siblings', () => {
  const { events, dependencies } = fixture({ consumeRestartIntent: () => ({ scope: 'current', currentWindowId: 'secondary' }) })
  restoreDesktopWindowsAtStartup(dependencies)
  assert.deepEqual(events, [
    ['create', 'secondary', false, undefined], ['persist', ['primary', 'secondary']],
    ['schedule', 900], ['create', 'primary', false, undefined], ['persist', undefined],
  ])
})

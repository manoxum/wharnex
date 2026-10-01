import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopProjectNavigation } from './navigation.mjs'

test('tray project action activates the owning window and addresses the exact project', () => {
  const events = []
  const window = {
    isDestroyed: () => false, isMinimized: () => true,
    restore: () => events.push('restore'), show: () => events.push('show'), focus: () => events.push('focus'),
  }
  const state = { window, projects: new Set(['/one/app', '/two/app']) }
  const navigation = createDesktopProjectNavigation({
    windows: new Map([['owner', state]]),
    sendToWindowState: (_, channel, payload) => events.push([channel, payload]),
    createWindow: () => { throw new Error('existing window should be reused') },
    setMainWindow: (active) => { assert.equal(active, window); events.push('main-window') },
  })

  assert.equal(navigation.projectMenuLabel('/one/app'), 'app · /one/app')
  assert.deepEqual(navigation.activeDesktopProjects(), ['/one/app', '/two/app'])
  assert.equal(navigation.sendDesktopTrayProjectAction('/one/app', 'open'), true)
  assert.deepEqual(events, [
    'restore', 'show', 'focus', 'main-window',
    ['wharness:windows:activate-project', { projectPath: '/one/app' }],
    ['wharness:tray:action', { projectPath: '/one/app', action: 'open' }],
  ])
  assert.equal(navigation.requestProjectClose('/missing'), false)
})

test('fallback creates a primary window only when no durable window remains', () => {
  const events = []
  const navigation = createDesktopProjectNavigation({
    windows: new Map(), sendToWindowState: () => {}, setMainWindow: () => {},
    createWindow: (id) => {
      events.push(`create:${id}`)
      return { window: { show: () => events.push('show'), focus: () => events.push('focus') } }
    },
  })
  assert.equal(navigation.showDesktopFallbackWindow(), true)
  assert.deepEqual(events, ['create:primary', 'show', 'focus'])
})

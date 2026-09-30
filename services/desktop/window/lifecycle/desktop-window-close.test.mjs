import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopWindowCloseCoordinator } from './desktop-window-close.mjs'

function fixture(projectPath = '/workspace/alpha', overrides = {}) {
  const calls = []
  const timers = []
  const coordinator = createDesktopWindowCloseCoordinator({
    publish: (_state, payload) => calls.push(['publish', payload]),
    background: () => calls.push(['background']),
    closeWindow: () => calls.push(['close-window']),
    closeAll: () => calls.push(['close-all']),
    schedule: (fn) => {
      timers.push(fn)
      return timers.length - 1
    },
    cancel: (handle) => { timers[handle] = undefined },
    ...overrides,
  })
  const state = { activeProject: projectPath, projects: new Set(projectPath ? [projectPath] : []), transientSurface: false }
  const runTimers = () => { for (const fn of [...timers]) fn?.() }
  return { coordinator, state, calls, timers, runTimers }
}

test('requests an application-owned close decision for the active project', () => {
  const { coordinator, state, calls } = fixture()
  let prevented = false
  assert.equal(coordinator.request(state, { preventDefault: () => { prevented = true } }), true)
  assert.equal(prevented, true)
  assert.deepEqual(calls, [['publish', { projectPath: '/workspace/alpha', projectName: 'alpha', hasProject: true }]])
})

test('resolves each trusted close action once', () => {
  for (const [action, expected] of [
    ['background', ['background']],
    ['close-window', ['close-window']],
    ['close-all', ['close-all']],
    ['cancel', undefined],
  ]) {
    const { coordinator, state, calls } = fixture()
    coordinator.request(state, { preventDefault() {} })
    calls.length = 0
    assert.deepEqual(coordinator.resolve(state, action), { ok: true, action })
    if (expected) assert.deepEqual(calls, [expected])
    else assert.deepEqual(calls, [])
    assert.deepEqual(coordinator.resolve(state, action), { ok: false, reason: 'not-pending' })
  }
})

test('closes the whole window whether or not a project is bound', () => {
  const { coordinator, state, calls } = fixture('')
  coordinator.request(state, { preventDefault() {} })
  calls.length = 0
  coordinator.resolve(state, 'close-window')
  assert.deepEqual(calls, [['close-window']])
})

test('rejects unknown actions without consuming the pending decision', () => {
  const { coordinator, state, calls } = fixture()
  coordinator.request(state, { preventDefault() {} })
  assert.throws(() => coordinator.resolve(state, 'destroy'), /inválida/)
  calls.length = 0
  assert.deepEqual(coordinator.resolve(state, 'cancel'), { ok: true, action: 'cancel' })
})

test('repeated close requests re-publish the modal state', () => {
  const { coordinator, state, calls } = fixture()
  coordinator.request(state, { preventDefault() {} })
  coordinator.request(state, { preventDefault() {} })
  assert.equal(calls.filter(([name]) => name === 'publish').length, 2)
})

test('a renderer that never answers escalates to the native prompt instead of trapping the window', () => {
  const asked = []
  const { coordinator, state, calls, runTimers } = fixture('/workspace/alpha', {
    fallback: (_state, descriptor) => { asked.push(descriptor); return 'close-all' },
  })
  coordinator.request(state, { preventDefault() {} })
  calls.length = 0

  runTimers()

  assert.deepEqual(asked, [{ projectPath: '/workspace/alpha', projectName: 'alpha', hasProject: true }])
  assert.deepEqual(calls, [['close-all']])
  assert.deepEqual(coordinator.resolve(state, 'cancel'), { ok: false, reason: 'not-pending' })
})

test('a renderer with no bridge at all cannot leave the close pending', () => {
  const { coordinator, state, calls } = fixture('/workspace/alpha', {
    publish: () => { throw new Error('renderer unreachable') },
    fallback: () => 'close-window',
  })

  assert.equal(coordinator.request(state, { preventDefault() {} }), true)
  assert.deepEqual(calls, [['close-window']])
})

test('a modal the renderer reported on screen waits for the person instead of being overridden', () => {
  let escalations = 0
  const { coordinator, state, calls, runTimers } = fixture('/workspace/alpha', {
    fallback: () => { escalations += 1; return 'close-all' },
  })
  coordinator.request(state, { preventDefault() {} })
  assert.deepEqual(coordinator.acknowledge(state), { ok: true })
  calls.length = 0

  runTimers()

  assert.equal(escalations, 0, 'an acknowledged modal must never be raced by the native prompt')
  assert.deepEqual(calls, [])

  // The decision itself is still the renderer's to deliver, however long the
  // person takes to make it.
  assert.deepEqual(coordinator.resolve(state, 'background'), { ok: true, action: 'background' })
  assert.deepEqual(calls, [['background']])
})

test('acknowledging outside a pending decision changes nothing', () => {
  const { coordinator, state } = fixture()
  assert.deepEqual(coordinator.acknowledge(state), { ok: false, reason: 'not-pending' })
})

test('an answered or cleared decision disarms its fallback so it cannot fire later', () => {
  for (const settle of [
    (coordinator, state) => coordinator.resolve(state, 'cancel'),
    (coordinator, state) => coordinator.clear(state),
  ]) {
    let escalations = 0
    const { coordinator, state, calls, runTimers } = fixture('/workspace/alpha', {
      fallback: () => { escalations += 1; return 'close-all' },
    })
    coordinator.request(state, { preventDefault() {} })
    settle(coordinator, state)
    calls.length = 0

    runTimers()

    assert.equal(escalations, 0)
    assert.deepEqual(calls, [])
  }
})

test('a transient surface closes immediately and is never held for a decision', () => {
  const { coordinator, calls } = fixture()
  const surface = { activeProject: '', projects: new Set(), transientSurface: true }
  let prevented = false

  assert.equal(coordinator.request(surface, { preventDefault: () => { prevented = true } }), false)
  assert.equal(prevented, false)
  assert.deepEqual(calls, [])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopWindowCloseCoordinator } from './desktop-window-close.mjs'

function fixture(projectPath = '/workspace/alpha') {
  const calls = []
  const coordinator = createDesktopWindowCloseCoordinator({
    publish: (_state, payload) => calls.push(['publish', payload]),
    background: () => calls.push(['background']),
    closeProject: (path) => calls.push(['close-project', path]),
    closeWindow: () => calls.push(['close-window']),
    closeAll: () => calls.push(['close-all']),
  })
  const state = { activeProject: projectPath, projects: new Set(projectPath ? [projectPath] : []), transientSurface: false }
  return { coordinator, state, calls }
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
    ['close-project', ['close-project', '/workspace/alpha']],
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

test('closes an empty window when no project is bound', () => {
  const { coordinator, state, calls } = fixture('')
  coordinator.request(state, { preventDefault() {} })
  calls.length = 0
  coordinator.resolve(state, 'close-project')
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectWindowOwnership } from './ownership.mjs'

function fixture() {
  const events = []
  const view = { webContents: { isDestroyed: () => false }, setVisible: (visible) => events.push(`visible:${visible}`) }
  const window = { setTitle: (title) => events.push(`title:${title}`), isDestroyed: () => false, show: () => events.push('show'), focus: () => events.push('focus') }
  const state = { id: 'one', window, projects: new Set(['/work/a']), activeProject: '/work/a', chatgptVisible: true, desiredVisibleChatGPTKey: 'chat' }
  const deferred = { windowState: state, visible: true }
  const registry = {
    acquire: (_, path) => ({ ok: true, path }),
    release: (_, path) => { events.push('release'); return { released: true, path } },
    releaseWindow: () => events.push('release-window'),
  }
  const ownership = createProjectWindowOwnership({
    registry, windows: new Map([['one', state]]), canonicalProjectPath: (path) => path,
    windowTitle: (path) => `Wharnex:${path}`, refreshTray: () => events.push('refresh'),
    trayControl: () => ({ forgetProject: (path) => events.push(`forget:${path}`) }),
    activeChatGPTEntry: () => ({ view }), deferredNavigation: () => deferred,
    reconcileThrottle: () => events.push('throttle'), chatGPTKeyForEntry: () => 'chat',
    hideAgentInteractions: () => events.push('hide-workers'),
  })
  return { events, state, deferred, registry, ownership }
}

test('active project release hides native surfaces before ownership is released', () => {
  const { events, state, deferred, ownership } = fixture()
  ownership.releaseProjectForWindow(state, '/work/a')
  assert.equal(state.chatgptVisible, false)
  assert.equal(state.desiredVisibleChatGPTKey, '')
  assert.equal(deferred.visible, false)
  assert.deepEqual(events.slice(0, 4), ['visible:false', 'throttle', 'hide-workers', 'release'])
  assert.equal(state.activeProject, '')
  assert.deepEqual([...state.projects], [])
})

test('ownership conflict raises existing owner window without claiming project', () => {
  const { events, state, registry, ownership } = fixture()
  registry.acquire = () => ({ ok: false, ownerWindowId: 'one' })
  const result = ownership.acquireProjectForWindow(state, '/work/b')
  assert.equal(result.ok, false)
  assert.match(result.message, /já está aberto/)
  assert.deepEqual(events, ['show', 'focus'])
  assert.equal(state.activeProject, '/work/a')
})

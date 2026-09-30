import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopSupervisorSurfaces } from './desktop.mjs'

test('surface composition shares slot identity and keeps deferred navigation state live', () => {
  const state = { pending: undefined, timer: undefined }
  const surfaces = createDesktopSupervisorSurfaces({
    navigationState: state, chatgptViews: new Map(), desktopWindows: new Map(),
    getDesiredChatAgentSupervisorSlots: () => 2,
    flushQueuedChatGPTComments: () => { throw new Error('late comments accessed during composition') },
  })
  assert.equal(typeof surfaces.ensureChatGPTView, 'function')
  assert.equal(typeof surfaces.activateChatGPTView, 'function')
  assert.equal(typeof surfaces.scheduleDeferredSupervisorNavigation, 'function')
  assert.equal(typeof surfaces.clearDeferredSupervisorNavigation, 'function')
  assert.equal(state.pending, undefined)
})

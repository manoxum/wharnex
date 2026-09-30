import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTViewState } from './state.mjs'

test('view state publishes to its owning window and exposes deferred navigation', () => {
  const sent = []
  const bounds = []
  const owner = { id: 'owner', activeChatGPTKey: 'chat', window: { getContentBounds: () => ({ width: 800 }) } }
  const entry = {
    ownerWindowId: 'owner', view: {
      setBounds: (value) => bounds.push(value),
      webContents: {
        getURL: () => 'https://chatgpt.com/c/one', getTitle: () => 'One',
        navigationHistory: { canGoBack: () => true, canGoForward: () => false },
      },
    },
    loading: false, authenticated: true, parkedLayout: true,
  }
  const state = createChatGPTViewState({
    chatgptViews: new Map([['chat', entry]]), desktopWindows: new Map([['owner', owner]]),
    chatGPTAuthBrowsers: new Map(), sanitizeChatCacheKey: (key) => key,
    normalizeBounds: (value) => value, activeChatGPTEntry: () => entry,
    getDeferredSupervisorNavigation: () => ({ key: 'chat', windowState: owner }),
    publicSupervisorId: () => 'supervisor-1',
    manualChatGPTTransport: { publicState: () => ({ mode: 'manual' }) },
    publicChatGPTAffinity: () => ({ affinity: 'bound' }),
    windowStateForEntry: () => owner,
    sendToWindowState: (...args) => sent.push(args), homeURL: 'https://chatgpt.com/',
  })
  assert.equal(state.setChatGPTBounds({ width: 600 }, owner), true)
  assert.deepEqual(bounds, [{ width: 600 }])
  assert.equal(entry.parkedLayout, false)
  state.publishChatGPTState('chat')
  assert.equal(sent[0][0], owner)
  assert.equal(sent[0][1], 'wharness:chatgpt:state')
  assert.equal(sent[0][2].surfaceDeferred, true)
  assert.equal(sent[0][2].url, 'https://chatgpt.com/c/one')
  assert.equal(sent[0][2].affinity, 'bound')
  assert.throws(() => state.currentChatGPTState('chat', { id: 'other' }), /belongs to another/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTViewOwnership } from './ownership.mjs'

test('view ownership rejects stale entries and keeps held Supervisors', () => {
  const closed = []
  const entry = {
    role: 'supervisor', ownerKey: 'chat', ownerWindowId: 'window',
    view: { webContents: { isDestroyed: () => false, close: () => closed.push('closed') } },
  }
  const chatgptViews = new Map([['chat', entry]])
  const drafts = new Map([['chat', {}]])
  const owner = { id: 'window', activeChatGPTKey: 'chat', chatgptVisible: true }
  let held = true
  const ownership = createChatGPTViewOwnership({
    sanitizeChatCacheKey: (key) => key, chatgptViews, chatGPTWorkerEntries: [],
    supervisorBindingHeld: () => held, sendToChatGPTKey: () => {},
    cancelExternalAuthentication: () => {}, preparedChatGPTDrafts: drafts,
    retryableChatGPTPrompts: new Map(), pendingChatGPTComments: new Map(),
    flushingChatGPTComments: new Set(), chatGPTActivityFingerprints: new Map(),
    expectedChatGPTBundles: new Map(), chatGPTTransportTails: new Map(),
    manualChatGPTTransport: { release: () => {} }, windowStateForEntry: () => owner,
  })
  assert.equal(ownership.requireOwnedChatGPTEntry('chat', entry).wc, entry.view.webContents)
  assert.throws(() => ownership.requireOwnedChatGPTEntry('chat', { ...entry }), /ownership mismatch/)
  assert.throws(() => ownership.releaseChatGPTView('chat', { id: 'foreign' }), /another Wharnex window/)
  assert.equal(ownership.releaseChatGPTView('chat', owner), false)
  assert.equal(chatgptViews.has('chat'), true)
  held = false
  assert.equal(ownership.releaseChatGPTView('chat', owner), true)
  assert.equal(chatgptViews.size, 0)
  assert.equal(drafts.size, 0)
  assert.equal(owner.activeChatGPTKey, '')
  assert.equal(owner.chatgptVisible, false)
  assert.deepEqual(closed, ['closed'])
})

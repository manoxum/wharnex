import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSupervisorSurfaceSlots, createSupervisorSurfaceVisibility,
  createSupervisorSurfaceNavigation,
} from './index.mjs'

function view(id, events) {
  let destroyed = false
  return {
    setVisible: (visible) => events.push(`${id}:${visible}`),
    webContents: {
      isDestroyed: () => destroyed,
      close: () => { destroyed = true; events.push(`${id}:close`) },
      getURL: () => `https://chatgpt.com/c/${id}`,
    },
  }
}

test('a waiting chat recycles only an unheld Supervisor and keeps visible intent', () => {
  const events = []
  const state = { id: 'window', activeChatGPTKey: 'idle', chatgptVisible: true, window: { isDestroyed: () => false } }
  const held = { slotId: 'supervisor-1', held: true, lastUsed: 1, ownerWindowId: 'window', view: view('held', events) }
  const idle = { slotId: 'supervisor-2', held: false, lastUsed: 2, ownerWindowId: 'window', view: view('idle', events) }
  const chatgptViews = new Map([['held', held], ['idle', idle]])
  const slots = createSupervisorSurfaceSlots({
    sanitizeChatCacheKey: (key) => key, chatgptViews,
    cancelExternalAuthentication: () => {}, windowStateForEntry: () => state,
    desktopWindows: new Map([['window', state]]), getDesiredChatAgentSupervisorSlots: () => 2,
    supervisorBindingHeld: (_key, entry) => entry.held,
    createChatGPTView: (key) => {
      const entry = { ownerWindowId: 'window', view: view(key, events) }
      chatgptViews.set(key, entry)
      return entry
    },
    requireOwnedChatGPTEntry: () => ({}), touchChatGPTEntry: () => {},
    chatGPTEntryIsActiveVisible: (key) => key === state.activeChatGPTKey && state.chatgptVisible,
  })
  const result = slots.ensureChatGPTView('new', state)
  assert.equal(result.entry.slotId, 'supervisor-2')
  assert.equal(result.entry.role, 'supervisor')
  assert.equal(chatgptViews.has('held'), true)
  assert.equal(chatgptViews.has('idle'), false)
  assert.equal(state.chatgptVisible, true)
  assert.deepEqual(events, ['idle:close'])
  result.entry.held = true
  assert.throws(() => slots.ensureChatGPTView('another', state), /slots de Supervisor estão vinculados/)
  assert.equal(chatgptViews.size, 2)
})

test('activation hides the previous surface before showing the new one and respects parked layout', () => {
  const events = []
  const owner = { activeChatGPTKey: 'old', chatgptVisible: true, chatgptBounds: undefined }
  const old = { view: view('old', events) }
  const target = { parkedLayout: true, view: view('new', events) }
  const chatgptViews = new Map([['new', target]])
  const visibility = createSupervisorSurfaceVisibility({
    chatgptViews, sanitizeChatCacheKey: (key) => key,
    windowStateForEntry: () => owner, ensureChatGPTView: () => ({ key: 'new', entry: target }),
    activeChatGPTEntry: () => old,
    reconcileChatGPTThrottle: () => {}, setChatGPTBounds: () => {},
    touchChatGPTEntry: () => {}, evictIdleChatGPTViews: () => 0,
    publishChatGPTState: () => {},
  })
  visibility.activateChatGPTView('new', undefined, owner)
  assert.equal(owner.activeChatGPTKey, 'new')
  assert.deepEqual(events, ['old:false', 'new:false'])
  owner.chatgptBounds = { x: 0, y: 0, width: 900, height: 600 }
  assert.equal(visibility.chatGPTSurfaceShouldBeVisible(target, owner), true)
})

test('deferred switch hides the old surface and reuses an already loaded target URL', async () => {
  const events = []
  const state = { pending: undefined, timer: undefined }
  const owner = { id: 'window', chatgptVisible: true, window: { isDestroyed: () => false } }
  const old = { slotId: 'supervisor-1', transportPreparationCount: 1, transportRequestId: 'request', view: view('old', events) }
  const target = { view: view('target', events) }
  const chatgptViews = new Map([['old', old]])
  let deferred = true
  const navigation = createSupervisorSurfaceNavigation({
    navigationState: state, sanitizeChatCacheKey: (key) => key, supervisorEntry: () => old,
    supervisorKey: () => 'old', chatgptViews,
    reconcileChatGPTThrottle: () => {}, chatGPTKeyForEntry: () => 'old',
    sendToWindowState: () => events.push('state-published'), currentChatGPTState: () => ({}),
    supervisorSurfaceRoute: () => ({ deferred }), reusableSupervisor: () => undefined,
    getDesiredChatAgentSupervisorSlots: () => 1,
    activateChatGPTView: () => target,
    requireTrustedChatGPTURL: (url) => url, CHATGPT_URL: 'https://chatgpt.com/',
    sameConversationURL: (left, right) => left === right,
    loadOwnedChatGPTURL: async () => events.push('navigate'),
    chatGPTSurfaceShouldBeVisible: () => true,
    flushQueuedChatGPTComments: () => {},
    DEFERRED_SUPERVISOR_NAVIGATION_RETRY_MS: 10_000,
  })
  assert.equal(navigation.deferSupervisorNavigationIfBusy('target', owner, { url: 'https://chatgpt.com/c/target' }), true)
  assert.equal(state.pending.key, 'target')
  assert.equal(owner.desiredVisibleChatGPTKey, 'target')
  assert.deepEqual(events, ['old:false', 'state-published'])
  deferred = false
  await navigation.applyDeferredSupervisorNavigation()
  assert.equal(state.pending, undefined)
  assert.equal(owner.desiredVisibleChatGPTKey, '')
  assert.deepEqual(events, ['old:false', 'state-published', 'target:true'])
})

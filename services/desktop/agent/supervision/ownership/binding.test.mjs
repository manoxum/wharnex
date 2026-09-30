import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupervisorOwnership } from './index.mjs'

function fixture() {
  const entry = {
    slotId: 'supervisor-1', affinity: { boundURL: 'https://chatgpt.com/c/owned' },
    view: { webContents: { isDestroyed: () => false, getURL: () => 'https://chatgpt.com/c/owned' } },
  }
  const chatgptViews = new Map([['chat', entry]])
  const chatgptTransportModes = new Map()
  const expectedChatGPTBundles = new Map([['chat', { requestId: 'request' }]])
  const pendingChatGPTBundleDeliveries = new Map()
  const chatGPTTransportTails = new Map()
  const chatSupervisorStates = new Map()
  const preparedChatGPTDrafts = new Map()
  let pendingComment = false
  let slots = 3
  const ownership = createSupervisorOwnership({
    chatgptViews, chatgptTransportModes, expectedChatGPTBundles,
    canonicalChatGPTConversationURL: (url) => url.startsWith('https://chatgpt.com/c/') ? url : '',
    sameConversationURL: (left, right) => left === right,
    pendingChatGPTBundleDeliveries, hasPendingChatGPTComments: () => pendingComment,
    chatGPTTransportTails, chatSupervisorStates,
    preparedChatGPTDrafts, retryableChatGPTPrompts: new Map(),
    RETRYABLE_PROMPT_TTL_MS: 30_000, getDesiredChatAgentSupervisorSlots: () => slots,
    sanitizeOptionalChatCacheKey: (key) => key || '',
    chatAgentConversationID: (url) => url.split('/').at(-1),
  })
  return {
    ownership, entry, chatgptTransportModes, expectedChatGPTBundles,
    pendingChatGPTBundleDeliveries, chatGPTTransportTails, chatSupervisorStates,
    preparedChatGPTDrafts, setPendingComment: (value) => { pendingComment = value },
    setSlots: (value) => { slots = value },
  }
}

test('only the owned, automated conversation may supervise its expected response', () => {
  const { ownership, entry, chatgptTransportModes } = fixture()
  assert.equal(ownership.chatGPTSupervisorOwnsExpectedResponse('chat', 'request', 'https://chatgpt.com/c/owned'), true)
  assert.equal(ownership.chatGPTSupervisorOwnsExpectedResponse('chat', 'other'), false)
  assert.equal(ownership.chatGPTSupervisorOwnsExpectedResponse('chat', 'request', 'https://chatgpt.com/c/other'), false)
  chatgptTransportModes.set('chat', 'manual')
  assert.equal(ownership.chatGPTSupervisorOwnsExpectedResponse('chat', 'request'), false)
  chatgptTransportModes.clear()
  entry.externalAuthProvider = true
  assert.equal(ownership.chatGPTSupervisorOwnsExpectedResponse('chat', 'request'), false)
})

test('binding stays held for live work and frees after the last hold expires', () => {
  const f = fixture()
  const { ownership, entry, expectedChatGPTBundles, pendingChatGPTBundleDeliveries,
    chatGPTTransportTails, chatSupervisorStates, preparedChatGPTDrafts } = f
  assert.equal(ownership.supervisorBindingHold('chat', entry), 'expected-bundle')
  pendingChatGPTBundleDeliveries.set('request', {})
  assert.equal(ownership.supervisorBindingHold('chat', entry), 'bundle-delivery')
  expectedChatGPTBundles.clear()
  pendingChatGPTBundleDeliveries.clear()
  f.setPendingComment(true)
  assert.equal(ownership.supervisorBindingHold('chat', entry), 'queued-comment')
  f.setPendingComment(false)
  chatGPTTransportTails.set('chat:chat', Promise.resolve())
  assert.equal(ownership.supervisorBindingHold('chat', entry), 'transport')
  chatGPTTransportTails.clear()
  chatSupervisorStates.set(1, { task: { chat_id: 'chat' } })
  assert.equal(ownership.supervisorBindingHold('chat', entry), 'supervisor-lease')
  chatSupervisorStates.clear()
  preparedChatGPTDrafts.set('chat', { preparedAt: Date.now() })
  assert.equal(ownership.supervisorBindingHold('chat', entry), 'prepared-prompt')
  preparedChatGPTDrafts.set('chat', { preparedAt: Date.now() - 31_000 })
  assert.equal(ownership.supervisorBindingHeld('chat', entry), false)
  assert.deepEqual([...ownership.chatSupervisorBoundLanes()], [])
  entry.accountOperationActive = true
  assert.deepEqual([...ownership.chatSupervisorBoundLanes()], ['h:chat', 'c:owned'])
  f.setSlots(2)
  assert.equal(ownership.chatSupervisorSlotID(99), 'supervisor-2')
})

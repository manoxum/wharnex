import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTNetworkActivity } from './network-activity.mjs'

test('network activity tracks the owned conversation request and recovery progress', () => {
  const records = []
  const recovery = {}
  const entry = {
    view: { webContents: { id: 7 } }, conversationRequests: new Map(),
    conversationTransportGeneration: 3, staleConversationRequestIds: new Set(['stale']),
  }
  const activity = createChatGPTNetworkActivity({
    chatgptViews: new Map([['chat', entry]]), chatGPTWorkerEntries: [],
    expectedChatGPTBundles: new Map([['chat', { recovery, requestId: 'req' }]]),
    isChatGPTConversationTransportURL: (url) => url === '/conversation',
    recordChatGPTConversationTransport: (...args) => records.push(args),
    noteChatGPTRecoveryProgress: (...args) => records.push(args),
    isRecoverableChatGPTNetworkError: () => true,
    noteChatGPTRecoveryFault: () => {},
  })
  activity.noteChatGPTNetworkActivity({ webContentsId: 7, url: '/conversation', id: 42, method: 'POST' }, 'before')
  assert.equal(entry.staleConversationRequestIds.size, 0)
  assert.equal(entry.lastConversationActivity, entry.lastNetworkActivity)
  assert.deepEqual(records[0].slice(0, 4), [entry.conversationRequests, '42', 3, 'before'])
  assert.equal(records[1][0], recovery)
  assert.equal(records[1][1], 'before:42:POST')
  entry.staleConversationRequestIds.add('42')
  activity.noteChatGPTNetworkActivity({ webContentsId: 7, url: '/conversation', id: 42 }, 'completed')
  assert.equal(entry.staleConversationRequestIds.size, 0)
  assert.equal(activity.chatGPTEntryForWebContentsID(99), undefined)
})

test('network failures affect only a supervised, recoverable owned request', () => {
  const faults = []
  const recovery = {}
  const worker = { ownerKey: 'chat', view: { webContents: { id: 8 } } }
  const activity = createChatGPTNetworkActivity({
    chatgptViews: new Map(), chatGPTWorkerEntries: [worker],
    expectedChatGPTBundles: new Map([['chat', { recovery, requestId: 'req' }]]),
    isChatGPTConversationTransportURL: (url) => url === '/conversation',
    recordChatGPTConversationTransport: () => {}, noteChatGPTRecoveryProgress: () => {},
    isRecoverableChatGPTNetworkError: (error) => error === 'recoverable',
    noteChatGPTRecoveryFault: (...args) => faults.push(args),
  })
  assert.equal(activity.noteChatGPTNetworkFailure({ webContentsId: 9, error: 'recoverable', url: '/conversation' }), false)
  assert.equal(activity.noteChatGPTNetworkFailure({ webContentsId: 8, error: 'other', url: '/conversation' }), false)
  assert.equal(activity.noteChatGPTNetworkFailure({ webContentsId: 8, error: 'recoverable', url: '/other' }), false)
  assert.equal(activity.noteChatGPTNetworkFailure({ webContentsId: 8, error: 'recoverable', url: '/conversation' }), true)
  assert.equal(faults.length, 1)
  assert.equal(faults[0][0], recovery)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { registerResumeExpectedBundleIPC } from './resume.mjs'
import { createChatAgentFollowups } from '../../../../agent/supervision/response/followups.mjs'

async function resume({ events = [], eventFailure = false, priorCount = 0, tasks = [] } = {}) {
  let handler, queued
  const expectations = new Map()
  const scheduler = {
    list: async () => ({ tasks }),
    requestEvents: async (requestId) => {
      assert.equal(requestId, 'req-1')
      if (eventFailure) throw new Error('ledger unavailable')
      return { events }
    },
  }
  const { expectedChatAgentPayload } = createChatAgentFollowups({
    canonicalChatGPTConversationURL: (value) => value,
    authoritativeBundleFilename: () => 'result.zip',
  })
  registerResumeExpectedBundleIPC({
    ipcMain: { handle: (_channel, value) => { handler = value } },
    trustedSender: () => ({}), sanitizeChatCacheKey: (value) => value,
    requireTrustedChatGPTURL: (value) => value, canonicalChatGPTConversationURL: (value) => value,
    authoritativeBundleFilename: () => 'result.zip', getChatAgentScheduler: () => scheduler,
    classifyChatGPTRequestDelivery: () => 'submitted',
    ensureChatGPTView: () => ({ entry: { loading: false } }), requireOwnedChatGPTEntry: () => {},
    withChatGPTTransportPreparation: (_key, _entry, _request, operation) => operation(),
    targetChatGPTComposer: async () => ({ wc: { isLoading: () => false } }),
    executeChatGPTDOMScript: async () => ({ submitted: true }),
    chatGPTSubmittedRequestEvidenceScript: () => 'exact-input-proof', chatInputArchiveFilename: () => 'input.zip',
    armExpectedChatGPTBundle: () => expectations.set('chat-1', { requestId: 'req-1', continuationCount: priorCount }),
    expectedChatGPTBundles: expectations, chatAgentInitialRequestWaitMs: () => 1000,
    durableWorkspaceChatID: () => '', expectedChatAgentPayload,
    enqueueChatAgentTask: async (type, value) => { queued = { type, ...value }; return { task_id: 'new-await' } },
  })
  const result = await handler({}, { cacheKey: 'chat-1', requestId: 'req-1', url: 'https://chatgpt.com/c/one' })
  return { result, queued, expected: expectations.get('chat-1') }
}

test('restart restoration observes only and recovers a continuation spent in the durable ledger', async () => {
  const { queued, expected } = await resume({
    tasks: [{ id: 'old-await', request_id: 'req-1', chat_id: 'chat-1', type: 'AWAIT_RESPONSE', status: 'ATTENTION', payload: { recovery_count: 0 } }],
    events: [{ task_id: 'old-await', request_id: 'req-1', chat_id: 'chat-1', type: 'chatgpt.recovery_keep_continue' }],
  })
  assert.equal(queued.payload.observation_only, true)
  assert.equal(queued.payload.recovery_count, 1)
  assert.equal(expected.rehydrating, true)
  assert.equal(expected.continuationCount, 1)
  assert.equal(expected.automaticContinuationSent, true)
  assert.equal(expected.mainRequestTaskId, 'new-await')
})

test('ledger outage cannot authorize another automatic continuation', async () => {
  const { queued, expected } = await resume({ eventFailure: true, priorCount: 2 })
  assert.equal(queued.payload.observation_only, true)
  assert.equal(queued.payload.recovery_count, 2)
  assert.equal(expected.rehydrating, true)
})

test('restoration preserves matching task budgets and ignores unrelated ledger identities', async () => {
  const { queued } = await resume({
    tasks: [{ request_id: 'req-1', chat_id: 'chat-1', payload: { recovery_count: 2 } },
      { request_id: 'other', chat_id: 'chat-1', payload: { recovery_count: 99 } }],
    events: [{ request_id: 'other', chat_id: 'chat-1', type: 'chatgpt.recovery_keep_continue' }],
  })
  assert.equal(queued.payload.recovery_count, 2)
  assert.equal(queued.payload.observation_only, true)
})

test('legacy ledger events with blank chat identity recover their budget through the exact owned task', async () => {
  const { queued } = await resume({
    tasks: [{ task_id: 'cat-original', request_id: 'req-1', chat_id: 'chat-1', payload: { recovery_count: 0 } }],
    events: [{ task_id: 'cat-original', request_id: 'req-1', chat_id: '', type: 'chatgpt.recovery_keep_continue' }],
  })
  assert.equal(queued.payload.recovery_count, 1)
  assert.equal(queued.payload.observation_only, true)
})

test('blank chat events without owned-task proof and explicitly different chats cannot spend this request budget', async () => {
  const { queued } = await resume({
    tasks: [{ task_id: 'cat-owned', request_id: 'req-1', chat_id: 'chat-1', payload: { recovery_count: 0 } }],
    events: [
      { task_id: 'cat-orphan', request_id: 'req-1', chat_id: '', type: 'chatgpt.recovery_keep_continue' },
      { task_id: 'cat-owned', request_id: 'req-1', chat_id: 'other-chat', type: 'chatgpt.recovery_keep_continue' },
    ],
  })
  assert.equal(queued.payload.recovery_count, 0)
  assert.equal(queued.payload.observation_only, true)
})

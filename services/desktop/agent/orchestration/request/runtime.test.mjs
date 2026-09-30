import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrchestratorRequestTransport } from './runtime.mjs'

function fixture({ pending = false, submitted = true } = {}) {
  const events = []
  const expectedChatGPTBundles = new Map()
  const runtime = createOrchestratorRequestTransport({
    pendingChatGPTBundleDeliveries: new Set(pending ? ['req-1'] : []),
    recentlyDeliveredChatGPTBundleRequestId: () => false,
    chatGPTBundleAlreadyValidated: () => false,
    getScheduler: () => ({ list: async () => { events.push('list'); return { tasks: [] } } }),
    expectedChatGPTBundles,
    sanitizeChatCacheKey: (value) => value,
    orchestratorConversationGuard: {
      ensureConversation: async () => events.push('ensure'),
      submissionHooks: () => ({ onSubmittedConversation: async () => {} }),
    },
    executeChatGPTDOMScript: async () => ({ submitted }),
    chatGPTSubmittedRequestEvidenceScript: () => 'script',
    chatInputArchiveFilename: () => 'request.zip',
    armExpectedChatGPTBundle: (key, requestId) => {
      events.push('arm')
      expectedChatGPTBundles.set(key, { requestId })
    },
    enqueueChatAgentFollowups: async () => { events.push('enqueue'); return { task_id: 'await-1' } },
    disarmExpectedChatGPTBundle: () => events.push('disarm'),
    clearChatGPTHumanAction: () => events.push('clear'),
    orchestratorRetryInput: async () => ({ attachments: [], projectFiles: [] }),
    readStoredAttachment: async () => Buffer.from(''),
    chatAttachmentRoot: () => '/tmp',
    withChatGPTTransportPreparation: async (_key, _entry, _id, operation) => operation(),
    preparePromptForChatGPT: async () => { events.push('submit'); return { submitted: true, conversationUrl: 'https://chatgpt.com/c/1' } },
    path: { basename: () => 'project' },
  })
  const current = { request_id: 'req-1', chat_id: 'chat-1', task: {}, prompt: 'prompt', agent_session_id: 'session-1' }
  return { runtime, events, current, expectedChatGPTBundles }
}

test('pending local delivery wins before queue observation', async () => {
  const { runtime, events } = fixture({ pending: true })
  assert.deepEqual(await runtime.orchestratorRequestSupervision('chat-1', 'req-1'), { state: 'delivered' })
  assert.deepEqual(events, [])
})

test('adoption requires exact submitted archive evidence', async () => {
  const missing = fixture({ submitted: false })
  assert.equal(await missing.runtime.adoptOrchestratorRequest('chat-1', {}, missing.current, 'https://chatgpt.com/c/1', 0), false)
  assert.deepEqual(missing.events, ['ensure'])
  const proven = fixture()
  assert.equal(await proven.runtime.adoptOrchestratorRequest('chat-1', {}, proven.current, 'https://chatgpt.com/c/1', 0), true)
  assert.deepEqual(proven.events, ['ensure', 'arm', 'enqueue'])
  assert.equal(proven.expectedChatGPTBundles.get('chat-1').mainRequestTaskId, 'await-1')
})

test('resend clears stale expectation before one provider submit', async () => {
  const { runtime, events, current, expectedChatGPTBundles } = fixture()
  expectedChatGPTBundles.set('chat-1', { requestId: 'req-1' })
  assert.deepEqual(await runtime.sendOrchestratorMainRequest('chat-1', {}, current, '', () => {}), {
    conversationUrl: 'https://chatgpt.com/c/1',
  })
  assert.deepEqual(events, ['disarm', 'clear', 'submit'])
})

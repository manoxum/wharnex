import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentWrite } from './write.mjs'

function fixture({ cooldown = 0, validated = false, enqueueError = false } = {}) {
  const events = []
  let scheduled
  const { executeChatAgentWrite } = createAgentWrite({
    paceChatGPTWorkerSubmission: async () => events.push('pace'),
    chatAgentRateLimitDelayMs: () => cooldown,
    sanitizeSessionId: (value) => value,
    canonicalChatGPTConversationURL: (value) => value,
    durableWorkspaceChatID: () => '',
    withChatGPTTransportPreparation: async (_key, _entry, _id, operation) => operation(),
    preparePromptForChatGPT: async () => ({ conversationUrl: 'https://chatgpt.com/c/1' }),
    chatGPTBundleAlreadyValidated: () => validated,
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS: 2,
    chatGPTDeliveryContinuationPrompt: () => 'continue',
    sameConversationURL: (a, b) => a === b,
    submitChatGPTContinuation: async () => { events.push('continue'); return { conversationUrl: 'https://chatgpt.com/c/1' } },
    submitPromptToChatGPT: async () => {
      events.push('submit')
      return { conversationUrl: 'https://chatgpt.com/c/1', expectedFilename: 'reply.zip', originalPrompt: 'hello' }
    },
    expectedChatGPTBundles: new Map(),
    recordChatGPTContinuationSent: () => events.push('record'),
    persistWorkspaceChatRemoteBestEffort: async () => events.push('persist'),
    expectedChatAgentPayload: (_key, _id, _url, values) => values,
    enqueueChatAgentTask: async (_type, request) => {
      events.push('enqueue')
      scheduled = request
      if (enqueueError) throw new Error('queue offline')
    },
    chatAgentInitialRequestWaitMs: () => 60_000,
  })
  const task = { type: 'BOT_WRITE', task_id: 'task-1', request_id: 'req-1' }
  const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/c/1' } } }
  const run = (payload, options) => executeChatAgentWrite(task, entry, 'chat-1', payload, 'https://chatgpt.com/c/1', options)
  return { run, events, scheduled: () => scheduled }
}

test('provider cooldown returns a free observation before any submission', async () => {
  const { run, events } = fixture({ cooldown: 25_000 })
  const result = await run({ prompt: 'hello' })
  assert.deepEqual(result, {
    status: 'waiting', delayMs: 25_000, observation: true,
    error: 'ChatGPT rate-limit cooldown is active',
  })
  assert.deepEqual(events, ['pace'])
})

test('validated continuation cannot replay a provider request', async () => {
  const { run, events } = fixture({ validated: true })
  assert.deepEqual(await run({ operation: 'CONTINUE_REQUEST' }), { status: 'done' })
  assert.deepEqual(events, ['pace'])
})

test('accepted write schedules exact response supervision after initial settle delay', async () => {
  const { run, events, scheduled } = fixture()
  const before = Date.now()
  assert.deepEqual(await run({ prompt: 'hello' }, { pacedWorker: false }), { status: 'done' })
  assert.deepEqual(events, ['submit', 'enqueue'])
  assert.equal(scheduled().dedupeKey, 'await:req-1')
  assert.equal(scheduled().parentTaskID, 'task-1')
  assert.ok(Date.parse(scheduled().notBefore) >= before + 60_000)
})

test('queue failure after an accepted write reports attention without replay', async () => {
  const { run, events } = fixture({ enqueueError: true })
  const result = await run({ prompt: 'hello' }, { pacedWorker: false })
  assert.equal(result.status, 'attention')
  assert.match(result.error, /req-1.*queue offline/)
  assert.deepEqual(events, ['submit', 'enqueue'])
})

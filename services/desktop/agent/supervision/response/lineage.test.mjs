import test from 'node:test'
import assert from 'node:assert/strict'
import { createResponseLineage } from './lineage.mjs'

function fixture({ validated = false, childExists = false } = {}) {
  const events = []
  const expectedChatGPTBundles = new Map()
  const scheduler = {
    recordTaskEvent: async () => events.push('record'),
    list: async () => ({ tasks: childExists ? [{ type: 'RECOVERY_WRITE', parent_task_id: 'await-1', status: 'RUNNING' }] : [] }),
  }
  const lineage = createResponseLineage({
    getScheduler: () => scheduler,
    expectedChatGPTBundles,
    armExpectedChatGPTBundle: (key, requestId) => {
      events.push('arm')
      expectedChatGPTBundles.set(key, { requestId, filename: 'response.zip', sessionId: 'session-1' })
    },
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS: 1,
    chatGPTProcessingDurationScript: () => 'duration-script',
    CHATGPT_BEHAVIOR: { labels: { reasoningDisclosure: 'reasoning' } },
    chatGPTBundleAlreadyValidated: () => validated,
    disarmExpectedChatGPTBundle: () => events.push('disarm'),
    BUNDLE_CONTINUATION_BASE_MS: 5_000,
    enqueueChatAgentTask: async (type) => events.push(`enqueue:${type}`),
  })
  return { lineage, events, expectedChatGPTBundles }
}

test('cold response expectation rehydrates passively from durable task payload once', async () => {
  const { lineage, events } = fixture()
  const task = { request_id: 'req-1' }
  const payload = { recovery_count: 0 }
  const expected = await lineage.hydrateExpectedChatAgentBundle('chat-1', task, payload)
  assert.equal(expected.requestId, 'req-1')
  assert.equal(expected.rehydrating, true)
  assert.equal(await lineage.hydrateExpectedChatAgentBundle('chat-1', task, payload), expected)
  assert.deepEqual(events, ['arm'])
})

test('validated bundle quiesces recovery before queuing a write', async () => {
  const { lineage, events } = fixture({ validated: true })
  const result = await lineage.enqueueChatAgentContinuation({}, 'chat-1', { requestId: 'req-1' }, {}, '', Date.now(), 'interrupted')
  assert.deepEqual(result, { status: 'done' })
  assert.deepEqual(events, ['disarm'])
})

test('only one child recovery write is queued for an interrupted response', async () => {
  const { lineage, events } = fixture({ childExists: true })
  const expected = { requestId: 'req-1', filename: 'response.zip', sessionId: 'session-1' }
  const result = await lineage.enqueueChatAgentContinuation(
    { task_id: 'await-1', request_id: 'req-1' }, 'chat-1', expected, {}, 'https://chatgpt.com/c/1', Date.now(), 'interrupted',
  )
  assert.deepEqual(result, { status: 'done' })
  assert.ok(!events.some((event) => event.startsWith('enqueue:')))
})

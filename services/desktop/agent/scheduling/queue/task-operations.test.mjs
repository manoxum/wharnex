import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatAgentTaskQueue } from './task-operations.mjs'

function fixture({ schedulerReady = true, initialWait = 90_000 } = {}) {
  const events = []
  let body
  const scheduler = {
    enqueue: async (value) => { events.push('enqueue'); body = value; return { task_id: 'task-1' } },
    enqueueWithRetry: async (value) => { events.push('retry'); body = value; return { task_id: 'task-1' } },
  }
  const queue = createChatAgentTaskQueue({
    getRuntimeDiagnostics: () => ({ provider: { initial_wait_ms: initialWait } }),
    getScheduler: () => schedulerReady ? scheduler : undefined,
    getSupervisorScheduler: () => ({ wake: () => events.push('wake') }),
    getPolicies: () => ({ auto_scale: true }),
    chatAgentConversationID: () => 'conversation-1',
    sanitizeChatCacheKey: (value) => value,
    canonicalChatGPTConversationURL: (value) => value,
    reconcileChatAgentAutoScale: () => events.push('scale'),
    persistWorkspaceChatRemote: async () => events.push('persist'),
    createHash: () => ({ update: () => ({ digest: () => 'abcdef0123456789' }) }),
    refreshChatAgentRuntimeState: async () => ({}),
    publishChatAgentRuntimeState: () => events.push('publish'),
  })
  return { queue, events, body: () => body }
}

test('request-bound response claim inherits the durable initial wait and wakes Supervisor', async () => {
  const { queue, events, body } = fixture()
  const before = Date.now()
  await queue.enqueueChatAgentTask('AWAIT_RESPONSE', {
    key: 'chat-1', requestId: 'req-1', conversationURL: 'https://chatgpt.com/c/1',
    dedupeKey: 'await:req-1', retry: true,
  })
  assert.deepEqual(events, ['retry', 'wake', 'scale'])
  assert.equal(body().dedupe_key, 'await:req-1')
  assert.ok(Date.parse(body().not_before) >= before + 90_000)
})

test('unbound lifecycle work is immediately eligible and a missing scheduler fails closed', async () => {
  const { queue, body } = fixture()
  const before = Date.now()
  await queue.enqueueChatAgentTask('ARCHIVE_CHAT', { key: 'chat-1' })
  assert.ok(Date.parse(body().not_before) >= before)
  assert.ok(Date.parse(body().not_before) < before + 5_000)
  const absent = fixture({ schedulerReady: false })
  await assert.rejects(absent.queue.enqueueChatAgentTask('BOT_WRITE', { key: 'chat-1' }), /scheduler is not ready/)
})

test('request wait from provider state is clamped to safe bounds', () => {
  assert.equal(fixture({ initialWait: 1 }).queue.chatAgentInitialRequestWaitMs(), 60_000)
  assert.equal(fixture({ initialWait: 20 * 60_000 }).queue.chatAgentInitialRequestWaitMs(), 15 * 60_000)
})

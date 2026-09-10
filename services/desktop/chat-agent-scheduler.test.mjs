import assert from 'node:assert/strict'
import test from 'node:test'
import { chatAgentBackoff, ChatAgentSchedulerClient, DEFAULT_CHAT_AGENT_WORKERS } from './chat-agent-scheduler.mjs'

test('scheduler defaults to exactly three autonomous workers', () => {
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    fetchImpl: async () => { throw new Error('unused') },
    execute: async () => ({ status: 'done' }),
  })
  assert.equal(scheduler.workerCount, DEFAULT_CHAT_AGENT_WORKERS)
  assert.equal(DEFAULT_CHAT_AGENT_WORKERS, 3)
})

test('backoff is bounded and grows with attempts', () => {
  const first = chatAgentBackoff(1, { jitter: () => 0.5 })
  const third = chatAgentBackoff(3, { jitter: () => 0.5 })
  const huge = chatAgentBackoff(20, { jitter: () => 0.5 })
  assert.equal(first, 2_000)
  assert.equal(third, 8_000)
  assert.equal(huge, 60_000)
})

test('enqueue preserves typed durable task fields', async () => {
  let request
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    fetchImpl: async (url, init) => {
      request = { url, init }
      return { ok: true, json: async () => ({ task_id: 'cat-1' }) }
    },
    execute: async () => ({ status: 'done' }),
  })
  await scheduler.enqueue({
    type: 'AWAIT_RESPONSE',
    chat_id: 'chat-1',
    conversation_id: 'conv-1',
    request_id: 'req-1',
    root_request_id: 'req-1',
    dedupe_key: 'await:req-1',
  })
  assert.equal(request.url, 'http://127.0.0.1:8080/api/chat-agent/tasks')
  const body = JSON.parse(request.init.body)
  assert.equal(body.type, 'AWAIT_RESPONSE')
  assert.equal(body.conversation_id, 'conv-1')
  assert.equal(body.dedupe_key, 'await:req-1')
})

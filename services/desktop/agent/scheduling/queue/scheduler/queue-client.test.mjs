import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatAgentSchedulerClient } from './index.mjs'

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

test('enqueue wakes idle claim loops immediately instead of waiting for the polling delay', async () => {
  let claimCount = 0
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080', workerCount: 1, idleMs: 10_000, taskCooldownMs: 0,
    fetchImpl: async (url) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) claimCount += 1
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'done' }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 50 && claimCount < 1; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2))
  assert.equal(claimCount, 1)

  await scheduler.enqueue({ type: 'DELETE_BUNDLE', chat_id: 'chat-1' })
  for (let attempt = 0; attempt < 50 && claimCount < 2; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2))
  await scheduler.stop()
  assert.ok(claimCount >= 2, `expected an immediate second claim, got ${claimCount}`)
})


test('queue depth is read as a backend aggregate instead of counted from a listed page', async () => {
  // Counting a listed page breaks once settled history outgrows it: the list is
  // ordered oldest-first, so the window fills with DONE rows and the live queue
  // disappears from the count entirely.
  const requested = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    fetchImpl: async (url) => {
      requested.push(url)
      return { ok: true, json: async () => ({ total: 36, counts: { PENDING: 36 }, due: 0, scheduled: 36 }) }
    },
    execute: async () => ({ status: 'done' }),
  })

  const summary = await scheduler.queueSummary()
  assert.deepEqual(requested, ['http://127.0.0.1:8080/api/chat-agent/tasks/summary'])
  assert.equal(summary.due, 0)
  assert.equal(summary.scheduled, 36)
})

test('enqueueWithRetry retries a transient enqueue failure and eventually succeeds', async () => {
  let attempts = 0
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    fetchImpl: async (url) => {
      if (url.endsWith('/api/chat-agent/tasks')) {
        attempts += 1
        if (attempts < 3) return { ok: false, status: 503, json: async () => ({ error: { message: 'unavailable' } }) }
        return { ok: true, json: async () => ({ task_id: 'cat_1' }) }
      }
      throw new Error(`unexpected url ${url}`)
    },
    execute: async () => ({ status: 'done' }),
  })
  const queued = await scheduler.enqueueWithRetry({ type: 'AWAIT_RESPONSE' }, { attempts: 5, baseMs: 1 })
  assert.equal(queued.task_id, 'cat_1')
  assert.equal(attempts, 3)
})

test('enqueueWithRetry surfaces the failure once every attempt is exhausted, so a Main Request never proceeds untracked', async () => {
  let attempts = 0
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    fetchImpl: async () => { attempts += 1; return { ok: false, status: 500, json: async () => ({ error: { message: 'down' } }) } },
    execute: async () => ({ status: 'done' }),
  })
  await assert.rejects(() => scheduler.enqueueWithRetry({ type: 'AWAIT_RESPONSE' }, { attempts: 3, baseMs: 1 }))
  assert.equal(attempts, 3)
})

test('recordTaskEvent posts the event to the task-scoped endpoint', async () => {
  const posted = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    fetchImpl: async (url, init) => {
      posted.push({ url, body: JSON.parse(init.body) })
      return { ok: true, json: async () => ({ id: 'cae_1' }) }
    },
    execute: async () => ({ status: 'done' }),
  })
  await scheduler.recordTaskEvent('cat_1', 'chatgpt.recovery_keep_continue', { reason: 'completed-without-bundle' }, { requestId: 'req_1', rootRequestId: 'req_root' })
  assert.equal(posted.length, 1)
  assert.ok(posted[0].url.endsWith('/api/chat-agent/tasks/cat_1/events'))
  assert.equal(posted[0].body.type, 'chatgpt.recovery_keep_continue')
  assert.equal(posted[0].body.request_id, 'req_1')
  assert.equal(posted[0].body.root_request_id, 'req_root')
})

test('recordTaskEvent never throws into the caller, matching the best-effort observability contract', async () => {
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    fetchImpl: async () => { throw new Error('network down') },
    execute: async () => ({ status: 'done' }),
  })
  const result = await scheduler.recordTaskEvent('cat_1', 'chatgpt.recovery_reload', {})
  assert.equal(result, undefined)
})

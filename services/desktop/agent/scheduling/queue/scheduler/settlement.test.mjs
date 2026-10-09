import assert from 'node:assert/strict'
import test from 'node:test'
import { chatAgentBackoff, chatAgentErrorDisposition, ChatAgentSchedulerClient } from './index.mjs'

test('backoff is bounded and grows with attempts', () => {
  const first = chatAgentBackoff(1, { jitter: () => 0.5 })
  const third = chatAgentBackoff(3, { jitter: () => 0.5 })
  const huge = chatAgentBackoff(20, { jitter: () => 0.5 })
  assert.equal(first, 2_000)
  assert.equal(third, 8_000)
  assert.equal(huge, 60_000)
})

test('artifact capacity failures require operator attention instead of blind provider retries', () => {
  assert.equal(chatAgentErrorDisposition(new Error('artifact_storage_full: armazenamento sem espaço livre')).action, 'attention')
  assert.equal(chatAgentErrorDisposition(new Error('ChatGPT upload timed out')).action, 'retry')
})

test('artifact capacity failure stops a durable write on its first attempt', async () => {
  const transitions = []
  let claimed = false
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080', workerCount: 1, idleMs: 1, taskCooldownMs: 0,
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        if (!claimed) {
          claimed = true
          return { ok: true, json: async () => ({ task: { task_id: 'cat-storage', type: 'BOT_WRITE', attempt: 1, max_attempts: 6 } }) }
        }
        return { ok: true, json: async () => ({}) }
      }
      transitions.push({ action: url.split('/').pop(), body: JSON.parse(String(init.body || '{}')) })
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => { throw new Error('artifact_storage_full: armazenamento sem espaço livre') },
  })
  scheduler.start()
  for (let attempt = 0; attempt < 100 && !transitions.some((item) => item.action === 'attention'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2))
  await scheduler.stop()
  assert.ok(transitions.some((item) => item.action === 'attention'))
  assert.ok(!transitions.some((item) => item.action === 'wait'))
})

test('final-attempt waiting task fails instead of becoming unreachable WAITING', async () => {
  const requests = []
  let claimed = false
  const task = { task_id: 'cat-final', type: 'ARCHIVE_CHAT', chat_id: 'chat-1', request_id: '', root_request_id: '', status: 'LEASED', attempt: 3, max_attempts: 3 }
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080', workerCount: 1, idleMs: 1, taskCooldownMs: 0,
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init })
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        if (!claimed) { claimed = true; return { ok: true, json: async () => ({ task }) } }
        return { ok: true, json: async () => ({}) }
      }
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'waiting', error: 'still not ready', delayMs: 1 }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 100 && !requests.some((request) => request.url.endsWith('/cat-final/fail')); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  assert.ok(requests.some((request) => request.url.endsWith('/cat-final/fail')))
  assert.ok(!requests.some((request) => request.url.endsWith('/cat-final/wait')))
})


test('a healthy observation is not charged an attempt and never trips the exhaustion guard', async () => {
  // AWAIT_RESPONSE probes a resident conversation every 30s for as long as the
  // model keeps working. Sharing the failure budget with those probes killed a
  // long but perfectly healthy response at max_attempts.
  const transitions = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 1,
    idleMs: 1,
    taskCooldownMs: 0,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        if (transitions.some((item) => item.action === 'wait')) return { ok: true, json: async () => ({}) }
        return { ok: true, json: async () => ({ task: { task_id: 'cat-1', type: 'AWAIT_RESPONSE', attempt: 30, max_attempts: 30 } }) }
      }
      const action = url.split('/').pop()
      transitions.push({ action, body: JSON.parse(String(init?.body || '{}')) })
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'waiting', delayMs: 30_000, observation: true }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 200 && !transitions.some((item) => item.action === 'wait'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()

  const wait = transitions.find((item) => item.action === 'wait')
  assert.ok(wait, 'an observation on the final attempt must still go back to WAITING')
  assert.equal(wait.body.observation, true)
  assert.equal(transitions.some((item) => item.action === 'fail'), false)
})

test('an ordinary retry on the final attempt still fails terminally', async () => {
  const transitions = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 1,
    idleMs: 1,
    taskCooldownMs: 0,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        if (transitions.some((item) => item.action === 'fail')) return { ok: true, json: async () => ({}) }
        return { ok: true, json: async () => ({ task: { task_id: 'cat-2', type: 'ORGANIZE_CHAT', attempt: 8, max_attempts: 8 } }) }
      }
      const action = url.split('/').pop()
      transitions.push({ action, body: JSON.parse(String(init?.body || '{}')) })
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'waiting', delayMs: 5_000, error: 'action-offscreen' }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 200 && !transitions.some((item) => item.action === 'fail'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  assert.ok(transitions.some((item) => item.action === 'fail'))
})


test('completed worker result payload is persisted through the complete transition', async () => {
  const transitions = []
  let claimed = false
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080', workerCount: 1, idleMs: 1, taskCooldownMs: 0,
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        if (claimed) return { ok: true, json: async () => ({}) }
        claimed = true
        return { ok: true, json: async () => ({ task: { task_id: 'cat-translation', type: 'TRANSLATE_MARKDOWN', attempt: 1, max_attempts: 2 } }) }
      }
      const action = url.split('/').pop()
      transitions.push({ action, body: JSON.parse(String(init?.body || '{}')) })
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({
      status: 'done',
      payload: { protocol: 'harness.utility/v1', task: 'translate_markdown', target_language: 'pt', markdown: 'Olá' },
    }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 100 && !transitions.some((item) => item.action === 'complete'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  const complete = transitions.find((item) => item.action === 'complete')
  assert.ok(complete)
  assert.equal(complete.body.payload.markdown, 'Olá')
  assert.equal(complete.body.payload.protocol, 'harness.utility/v1')
})

// An empty claim is the only evidence a resident lane has run dry, so the
// scheduler has to report it: without it residency never expires.
test('an observation on the final attempt is not treated as exhaustion', async () => {
  const transitions = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 1,
    idleMs: 1,
    taskCooldownMs: 0,
    fetchImpl: async (url) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        return transitions.length
          ? { ok: true, json: async () => ({}) }
          : { ok: true, json: async () => ({ task: { task_id: 'cat-1', attempt: 30, max_attempts: 30 } }) }
      }
      const match = url.match(/\/tasks\/cat-1\/(\w+)$/)
      if (match) transitions.push(match[1])
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'waiting', observation: true, delayMs: 1_000 }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 200 && !transitions.includes('wait') && !transitions.includes('fail'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  assert.ok(transitions.includes('wait'))
  assert.ok(!transitions.includes('fail'))
})

// The pool is shared across projects, but a Worker may only take work the
// operator can supervise. The Desktop is the only side that knows which
// projects are open in which windows, so the claim has to carry that scope —
// and carry the flag separately, because "no project is open" and "this caller
// cannot scope" are opposite instructions one empty list cannot express.

test('an upload-limit deferral on the final attempt waits as a free observation instead of failing', async () => {
  const transitions = []
  let claimed = false
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080', workerCount: 1, idleMs: 1, taskCooldownMs: 0,
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        if (!claimed) {
          claimed = true
          return { ok: true, json: async () => ({ task: { task_id: 'cat-upload', type: 'BOT_WRITE', attempt: 6, max_attempts: 6 } }) }
        }
        return { ok: true, json: async () => ({}) }
      }
      transitions.push({ action: url.split('/').pop(), body: JSON.parse(String(init.body || '{}')) })
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => { throw Object.assign(new Error('ChatGPT account file-upload limit is active'), { freeDeferral: true, delayMs: 600_000 }) },
  })
  scheduler.start()
  for (let attempt = 0; attempt < 100 && !transitions.some((item) => item.action === 'wait'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2))
  await scheduler.stop()
  const wait = transitions.find((item) => item.action === 'wait')
  assert.ok(wait, 'the task must wait, not fail')
  assert.equal(wait.body.observation, true)
  assert.ok(Date.parse(wait.body.not_before) - Date.now() > 590_000)
  assert.ok(!transitions.some((item) => item.action === 'fail'))
})

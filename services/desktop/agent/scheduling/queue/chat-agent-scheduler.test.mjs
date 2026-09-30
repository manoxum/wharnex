import assert from 'node:assert/strict'
import test from 'node:test'
import { chatAgentBackoff, chatAgentErrorDisposition, ChatAgentSchedulerClient, DEFAULT_CHAT_AGENT_TASK_COOLDOWN_MS, DEFAULT_CHAT_AGENT_WORKERS } from './chat-agent-scheduler.mjs'

test('scheduler defaults to exactly three autonomous small-task workers', () => {
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    fetchImpl: async () => { throw new Error('unused') },
    execute: async () => ({ status: 'done' }),
  })
  assert.equal(scheduler.workerCount, DEFAULT_CHAT_AGENT_WORKERS)
  assert.equal(DEFAULT_CHAT_AGENT_WORKERS, 3)
  assert.equal(scheduler.role, '')
})

test('a role-partitioned pool names itself in every claim so the queue can route by pool', async () => {
  const claims = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 1, maxWorkers: 6, idleMs: 1, taskCooldownMs: 0,
    role: 'supervisor', agentID: (index) => `supervisor-${index}`,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) claims.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'done' }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 100 && claims.length < 1; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  assert.ok(claims.length >= 1)
  assert.equal(claims[0].role, 'supervisor')
  assert.equal(claims[0].worker_id, 'supervisor-1')
  assert.match(claims[0].owner, /:supervisor-1$/)
})

test('scheduler can apply an explicit cooldown before a worker claims another task', async () => {
  const claimTimes = []
  let claimCount = 0
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 1,
    idleMs: 1,
    taskCooldownMs: 20,
    fetchImpl: async (url) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        claimTimes.push(Date.now())
        claimCount += 1
        if (claimCount === 1) return { ok: true, json: async () => ({ task: { task_id: 'cat-1', attempt: 1, max_attempts: 3 } }) }
        return { ok: true, json: async () => ({}) }
      }
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'done' }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 100 && claimTimes.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  assert.equal(DEFAULT_CHAT_AGENT_TASK_COOLDOWN_MS, 2_500)
  assert.ok(claimTimes.length >= 2)
  assert.ok(claimTimes[1] - claimTimes[0] >= 15)
})

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


test('runtime worker scaling is bounded without restarting the scheduler client', () => {
  const states = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    maxWorkers: 6,
    fetchImpl: async () => { throw new Error('unused') },
    execute: async () => ({ status: 'done' }),
    onState: (state) => states.push(state),
  })
  assert.equal(scheduler.setWorkerCount(5), 5)
  assert.equal(scheduler.setWorkerCount(99), 6)
  assert.equal(scheduler.setWorkerCount(0), 1)
  assert.equal(scheduler.workerCount, 1)
  assert.deepEqual(states.map((state) => state.workerCount), [5, 6, 1])
})


test('scale down waits for a worker loop to stop before it can be retired', async () => {
  const states = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 2,
    idleMs: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    execute: async () => ({ status: 'done' }),
    onState: (state) => states.push(state),
  })
  scheduler.start()
  scheduler.setWorkerCount(1)
  for (let attempt = 0; attempt < 50 && !states.some((state) => state.kind === 'worker-stopped' && state.worker === 2); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  expectWorkerStopped(states, 2)
  await scheduler.stop()
})

function expectWorkerStopped(states, worker) {
  assert.ok(states.some((state) => state.kind === 'worker-started' && state.worker === worker))
  assert.ok(states.some((state) => state.kind === 'worker-stopped' && state.worker === worker))
}


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


test('scheduler sends affinity-aware claim options supplied by the residency layer', async () => {
  let claimBody
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080', workerCount: 1, idleMs: 1, taskCooldownMs: 0,
    claimOptions: () => ({ preferred_lane: 'c:conv-a', excluded_lanes: ['c:conv-b'], excluded_types: ['RENAME_CHAT'], fallback_mode: 'resident_only' }),
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        claimBody = JSON.parse(init.body)
        return { ok: true, json: async () => ({}) }
      }
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'done' }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 50 && !claimBody; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2))
  await scheduler.stop()
  assert.equal(claimBody.worker_id, 'worker-1')
  assert.equal(claimBody.preferred_lane, 'c:conv-a')
  assert.deepEqual(claimBody.excluded_lanes, ['c:conv-b'])
  assert.deepEqual(claimBody.excluded_types, ['RENAME_CHAT'])
  assert.equal(claimBody.fallback_mode, 'resident_only')
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
test('a claim that finds no task reports the worker as idle', async () => {
  const idle = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 1,
    idleMs: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    execute: async () => ({ status: 'done' }),
    onIdle: (worker) => idle.push(worker),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 100 && idle.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  assert.ok(idle.length >= 2)
  assert.deepEqual([...new Set(idle)], [1])
})

// A passive observation never reached ChatGPT, so charging it the provider
// cooldown spends pool capacity protecting a request that was never made.
test('an observation hands the slot back without paying the provider cooldown', async () => {
  const claimTimes = []
  let claimCount = 0
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 1,
    idleMs: 1,
    taskCooldownMs: 200,
    fetchImpl: async (url) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) {
        claimTimes.push(Date.now())
        claimCount += 1
        if (claimCount === 1) return { ok: true, json: async () => ({ task: { task_id: 'cat-1', attempt: 1, max_attempts: 30 } }) }
        return { ok: true, json: async () => ({}) }
      }
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'waiting', observation: true, delayMs: 1_000 }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 200 && claimTimes.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  assert.ok(claimTimes.length >= 2)
  assert.ok(claimTimes[1] - claimTimes[0] < 200, `observation waited ${claimTimes[1] - claimTimes[0]}ms for a cooldown it never earned`)
})

// The exhaustion guard must stay blind to observations: a long but healthy
// response would otherwise have its own supervisor killed on the final attempt.
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
test('claim forwards the open-project scope to the durable claim', async () => {
  const bodies = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 1,
    idleMs: 1,
    claimOptions: () => ({ fallback_mode: 'any', project_scoped: true, open_projects: ['/home/op/alpha'] }),
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'done' }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 100 && !bodies.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  assert.ok(bodies.length >= 1)
  assert.equal(bodies[0].project_scoped, true)
  assert.deepEqual(bodies[0].open_projects, ['/home/op/alpha'])
})

test('a caller that does not scope by project claims exactly as before', async () => {
  const bodies = []
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    workerCount: 1,
    idleMs: 1,
    fetchImpl: async (url, init) => {
      if (url.endsWith('/api/chat-agent/tasks/claim')) bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({}) }
    },
    execute: async () => ({ status: 'done' }),
  })
  scheduler.start()
  for (let attempt = 0; attempt < 100 && !bodies.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  await scheduler.stop()
  assert.ok(bodies.length >= 1)
  assert.equal(bodies[0].project_scoped, false)
  assert.deepEqual(bodies[0].open_projects, [])
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { chatAgentBackoff, ChatAgentSchedulerClient, DEFAULT_CHAT_AGENT_TASK_COOLDOWN_MS, DEFAULT_CHAT_AGENT_WORKERS } from './chat-agent-scheduler.mjs'

test('scheduler defaults to exactly six autonomous workers', () => {
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080',
    fetchImpl: async () => { throw new Error('unused') },
    execute: async () => ({ status: 'done' }),
  })
  assert.equal(scheduler.workerCount, DEFAULT_CHAT_AGENT_WORKERS)
  assert.equal(DEFAULT_CHAT_AGENT_WORKERS, 6)
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
    claimOptions: () => ({ preferred_lane: 'c:conv-a', excluded_lanes: ['c:conv-b'], fallback_mode: 'resident_only' }),
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
  assert.equal(claimBody.preferred_lane, 'c:conv-a')
  assert.deepEqual(claimBody.excluded_lanes, ['c:conv-b'])
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

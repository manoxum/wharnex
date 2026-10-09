import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatAgentSchedulerClient, DEFAULT_CHAT_AGENT_TASK_COOLDOWN_MS, DEFAULT_CHAT_AGENT_WORKERS } from './index.mjs'

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

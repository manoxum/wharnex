import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatAgentSchedulerClient } from './index.mjs'

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

import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatAgentSchedulerClient } from './chat-agent-scheduler.mjs'

test('task transitions ask the engine for a minimal acknowledgement', async () => {
  const seen = []
  let claimed = false
  const scheduler = new ChatAgentSchedulerClient({
    baseURL: 'http://127.0.0.1:8080', workerCount: 1, idleMs: 1, taskCooldownMs: 0,
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), prefer: init.headers?.Prefer })
      const task = !claimed && String(url).endsWith('/claim') ? { task_id: 'cat_1', attempt: 1, max_attempts: 3 } : undefined
      if (task) claimed = true
      return new Response(JSON.stringify(task ? { task } : { task: null, status: 'ok' }), { status: 200 })
    },
    execute: async () => { scheduler.stop?.(); return { status: 'done' } },
  })
  scheduler.start()
  for (let i = 0; i < 50 && !seen.some((call) => call.url.endsWith('/complete')); i++) await new Promise((resolve) => setTimeout(resolve, 5))
  scheduler.stop?.()
  const transitions = seen.filter((call) => /\/(start|complete)$/.test(call.url))
  assert.ok(transitions.length >= 2, `expected start and complete, saw ${JSON.stringify(seen)}`)
  assert.ok(transitions.every((call) => call.prefer === 'return=minimal'))
  assert.ok(seen.filter((call) => call.url.endsWith('/claim')).every((call) => call.prefer === undefined))
})

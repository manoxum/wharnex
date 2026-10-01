import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatAgentRuntimeRefresh } from './refresh.mjs'

test('runtime refresh reconciles durable Worker leases and queue diagnostics', async () => {
  const workers = new Map()
  const state = {
    scheduler: {
      instanceID: 'desktop', running: true,
      queueSummary: async () => ({ due: 2 }),
      list: async ({ status }) => ({ tasks: status === 'LEASED' ? [{ status, lease_owner: 'desktop:worker-1', updated_at: '2026-09-30T00:00:00Z' }] : [] }),
      providerState: async () => ({ provider: 'chatgpt', paused: false, updated_at: '2026-09-30T00:00:00Z' }),
    },
    desiredWorkerSlots: 1, diagnostics: {}, rateLimitUntil: 0,
    resumeProbeRequired: false, rateLimitKind: '', rateLimitAppliedAt: 0,
  }
  const runtime = createChatAgentRuntimeRefresh({
    state, chatGPTWorkerEntries: [{}], chatAgentWorkerStates: workers,
    HARD_MAX_WORKER_SLOTS: 10, chatAgentQueueDiagnostics: ({ due }) => ({ due }),
    runtimeState: () => state.diagnostics,
  })
  await runtime.refreshChatAgentRuntimeState()
  assert.equal(workers.get(1).task.lease_owner, 'desktop:worker-1')
  assert.equal(state.diagnostics.queue.due, 2)
  assert.equal(state.diagnostics.scheduler.backend_reachable, true)
  runtime.reconcileChatAgentWorkerTasks([])
  assert.equal(workers.get(1).task, undefined)
})

test('runtime refresh follows the durable rate-limit deadline without clearing a newer local gate', async () => {
  let provider = {
    paused: true, paused_until: '2026-09-30T00:10:00Z',
    last_rate_limit_source: 'provider', updated_at: '2026-09-30T00:00:00Z',
  }
  const state = {
    scheduler: {
      instanceID: 'desktop', running: true,
      queueSummary: async () => ({}), list: async () => ({ tasks: [] }),
      providerState: async () => provider,
    },
    desiredWorkerSlots: 0, diagnostics: {}, rateLimitUntil: 0,
    resumeProbeRequired: false, rateLimitKind: '', rateLimitAppliedAt: 0,
  }
  const runtime = createChatAgentRuntimeRefresh({
    state, chatGPTWorkerEntries: [], chatAgentWorkerStates: new Map(),
    HARD_MAX_WORKER_SLOTS: 10, chatAgentQueueDiagnostics: () => ({}), runtimeState: () => ({}),
  })
  await runtime.refreshChatAgentRuntimeState()
  assert.equal(state.rateLimitUntil, Date.parse(provider.paused_until))
  assert.equal(state.resumeProbeRequired, true)
  state.rateLimitAppliedAt = Date.parse('2026-09-30T00:05:00Z')
  provider = { paused: false, updated_at: '2026-09-30T00:04:00Z' }
  await runtime.refreshChatAgentRuntimeState()
  assert.notEqual(state.rateLimitUntil, 0)
  provider.updated_at = '2026-09-30T00:06:00Z'
  await runtime.refreshChatAgentRuntimeState()
  assert.equal(state.rateLimitUntil, 0)
  assert.equal(state.rateLimitAppliedAt, 0)
})

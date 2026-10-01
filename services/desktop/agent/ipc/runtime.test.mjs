import assert from 'node:assert/strict'
import test from 'node:test'
import { registerAgentRuntimeIPC } from './runtime.mjs'

function fixture() {
  const handlers = new Map()
  const calls = []
  const state = {
    supervisorSlots: 2,
    workerSlots: 3,
    policies: { auto_scale: false, keep_flowing_workers: [] },
    scheduler: { setProviderPause: async (...args) => calls.push(['pause', ...args]) },
    clearRateLimit: () => calls.push(['clear-rate-limit']),
  }
  const trustedSender = (event) => {
    if (event?.trusted !== true) throw new Error('untrusted sender')
    return { id: 'window-1' }
  }
  registerAgentRuntimeIPC({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    trustedSender, state,
    normalizeSupervisorSlotCount: (count) => Number(count),
    normalizeWorkerSlotCount: (count) => Number(count),
    setChatAgentSupervisorTarget: (count) => calls.push(['supervisors', count]),
    setChatAgentWorkerTarget: (count, windowState) => calls.push(['workers', count, windowState.id]),
    chatAgentKeepFlowingFloor: () => 1,
    refreshChatAgentRuntimeState: async () => calls.push(['refresh']),
    publishChatAgentRuntimeState: () => ({ ok: true }),
    reconcileChatAgentAutoScale: async () => calls.push(['auto-scale']),
    normalizeChatAgentPolicies: (policies) => policies,
    persistChatAgentPolicies: () => calls.push(['persist']),
    pauseChatAgentWorkers: () => ({ paused: true }),
    resumeChatAgentWorkers: () => ({ paused: false }),
  })
  return { handlers, calls, state, trustedEvent: { trusted: true } }
}

test('agent runtime IPC rejects an untrusted sender before changing capacity', async () => {
  const { handlers, calls, state } = fixture()
  await assert.rejects(handlers.get('wharness:agents:set-worker-count')({ trusted: false }, { count: 5 }), /untrusted sender/)
  assert.equal(state.workerSlots, 3)
  assert.deepEqual(calls, [])
})

test('agent runtime IPC updates the configured worker target', async () => {
  const { handlers, calls, state, trustedEvent } = fixture()
  assert.deepEqual(await handlers.get('wharness:agents:set-worker-count')(trustedEvent, { count: 4 }), { ok: true })
  assert.equal(state.workerSlots, 4)
  assert.deepEqual(calls, [['workers', 4, 'window-1'], ['refresh']])
})

test('agent runtime IPC validates provider pause deadline and clears limits on manual resume', async () => {
  const { handlers, calls, trustedEvent } = fixture()
  await assert.rejects(handlers.get('wharness:agents:pause-provider')(trustedEvent, { pausedUntil: '2001-01-01' }), /future/)
  assert.deepEqual(calls, [])
  await handlers.get('wharness:agents:pause-provider')(trustedEvent, {})
  assert.deepEqual(calls[0], ['pause', true, { pausedUntil: null, reason: 'Suspenso pelo utilizador até retoma manual' }])
  await handlers.get('wharness:agents:resume-provider')(trustedEvent)
  assert.deepEqual(calls.slice(-3), [['clear-rate-limit'], ['pause', false], ['refresh']])
})

test('keep flowing accepts only canonical worker ids', async () => {
  const { handlers, state, trustedEvent } = fixture()
  await assert.rejects(handlers.get('wharness:agents:set-worker-keep-flowing')(trustedEvent, { agentId: 'supervisor-1', enabled: true }), /valid Worker id/)
  await handlers.get('wharness:agents:set-worker-keep-flowing')(trustedEvent, { agentId: 'worker-2', enabled: true })
  assert.deepEqual(state.policies.keep_flowing_workers, ['worker-2'])
})

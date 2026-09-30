import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { autoScaleWorkerDemand } from './chat-agent-auto-scale.mjs'
import { createChatAgentAutoScaleRuntime } from './auto-scale-runtime.mjs'
import { translatorCapacityTarget } from './chat-agent-translator-capacity.mjs'
import { autoScaleDrainTarget, autoScaleTarget } from './chat-agent-policies.mjs'

test('Auto scale sizes each pool from its own claimable backlog', async () => {
  const source = await readFile(new URL('./auto-scale-runtime.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function reconcileChatAgentAutoScale(')
  const fn = source.slice(start, source.indexOf('\n  function reconcileChatTranslatorCapacity', start))
  assert.match(fn, /reconcileChatAgentSupervisorAutoScale\(queue\)/)
  assert.match(fn, /autoScaleWorkerDemand\(summary, state\.chatAgentPolicies\)/)
  assert.match(fn, /autoScaleTarget\(\{\s*enabled: true, due: dueWorker/)
  assert.doesNotMatch(fn, /due: queue\.due,/)

  const supervisorStart = source.indexOf('function reconcileChatAgentSupervisorAutoScale(')
  const supervisor = source.slice(supervisorStart)
  assert.match(supervisor, /dueLanes: queue\.due_supervisor_lanes/)
  assert.match(supervisor, /maxSupervisors: state\.chatAgentPolicies\.auto_scale_max_supervisors/)
  assert.match(supervisor, /setChatAgentSupervisorTarget\(grow\)/)
})

test('partial Worker suspension keeps permitted tasks eligible for Auto scale', () => {
  const queue = { due_worker: 5, due_worker_by_type: { ORGANIZE_CHAT: 3, ORCHESTRATOR_PLAN: 2 } }
  const policies = { workers_suspended: true, workers_suspended_types: ['ORGANIZE_CHAT'] }
  assert.equal(autoScaleWorkerDemand(queue, policies), 2)
  assert.equal(autoScaleWorkerDemand(queue, { ...policies, workers_suspended_types: [] }), 0)
  assert.equal(autoScaleWorkerDemand(queue, { ...policies, workers_suspended: false }), 5)
})

test('Auto scale reconciler grows for permitted due work under partial suspension', async () => {
  const state = {
    chatAgentScheduler: { queueSummary: async () => ({ due_worker: 3, due_worker_by_type: { ORGANIZE_CHAT: 1, ORCHESTRATOR_PLAN: 2 } }) },
    chatAgentPolicies: { auto_scale: true, auto_scale_max_workers: 6, workers_suspended: true, workers_suspended_types: ['ORGANIZE_CHAT'] },
    chatAgentRuntimeDiagnostics: { provider: { paused: false } },
    desiredChatAgentWorkerSlots: 2, configuredChatAgentWorkerSlots: 2,
    desiredChatAgentSupervisorSlots: 2, configuredChatAgentSupervisorSlots: 2,
    chatAgentWorkerLastGrowAt: 0, chatAgentSupervisorLastGrowAt: 0,
  }
  const runtime = createChatAgentAutoScaleRuntime({
    state,
    chatAgentQueueDiagnostics: (value) => value,
    chatAgentRateLimitDelayMs: () => 0,
    autoScaleWorkerDemand,
    translatorCapacityTarget,
    activeChatTranslatorSlots: new Set(),
    autoScaleTarget,
    autoScaleDrainTarget,
    CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS: 20_000,
    chatAgentKeepFlowingFloor: () => 0,
    chatAgentAvailableWorkers: () => 0,
    chatAgentAvailableSupervisors: () => 0,
    autoScaleSupervisorTarget: () => 2,
    autoScaleSupervisorDrainTarget: () => 2,
    setChatAgentSupervisorTarget: () => {},
    chatgptViews: new Map(),
    setChatAgentWorkerTarget: (count) => { state.desiredChatAgentWorkerSlots = count },
    publishChatAgentRuntimeState: () => {},
  })
  await runtime.reconcileChatAgentAutoScale()
  assert.equal(state.desiredChatAgentWorkerSlots, 4)
})

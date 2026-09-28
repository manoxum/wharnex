import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { autoScaleWorkerDemand } from './chat-agent-auto-scale.mjs'
import { translatorCapacityTarget } from './chat-agent-translator-capacity.mjs'
import { autoScaleDrainTarget, autoScaleTarget } from './chat-agent-policies.mjs'

test('Auto scale sizes each pool from its own claimable backlog', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function reconcileChatAgentAutoScale(')
  const fn = source.slice(start, source.indexOf('\nfunction reconcileChatGPTWorkerPool', start))
  assert.match(fn, /reconcileChatAgentSupervisorAutoScale\(queue\)/)
  assert.match(fn, /autoScaleWorkerDemand\(summary, chatAgentPolicies\)/)
  assert.match(fn, /autoScaleTarget\(\{\s*enabled: true, due: dueWorker/)
  assert.doesNotMatch(fn, /due: queue\.due,/)

  const supervisorStart = source.indexOf('function reconcileChatAgentSupervisorAutoScale(')
  const supervisor = source.slice(supervisorStart, source.indexOf('\nfunction reconcileChatGPTWorkerPool', supervisorStart))
  assert.match(supervisor, /dueLanes: queue\.due_supervisor_lanes/)
  assert.match(supervisor, /maxSupervisors: chatAgentPolicies\.auto_scale_max_supervisors/)
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
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function reconcileChatAgentAutoScale()')
  const end = source.indexOf('\n// Auto scale for the Supervisor pool.', start)
  assert.ok(start >= 0 && end > start)
  const fn = source.slice(start, end)
  const warnings = []
  const context = {
    chatAgentScheduler: { queueSummary: async () => ({ due_worker: 3, due_worker_by_type: { ORGANIZE_CHAT: 1, ORCHESTRATOR_PLAN: 2 } }) },
    chatAgentPolicies: { auto_scale: true, auto_scale_max_workers: 6, workers_suspended: true, workers_suspended_types: ['ORGANIZE_CHAT'] },
    chatAgentQueueDiagnostics: (value) => value,
    chatAgentRuntimeDiagnostics: { provider: { paused: false } },
    reconcileChatAgentSupervisorAutoScale: () => false,
    chatAgentRateLimitDelayMs: () => 0,
    workerSuspensionState: () => ({ paused: true, task_types: ['ORGANIZE_CHAT'] }),
    chatAgentAvailableWorkers: () => 0,
    workerSuspendsAllTaskTypes: () => false,
    chatAgentRateLimitResumeBlocked: () => false,
    autoScaleWorkerDemand,
    translatorCapacityTarget,
    activeChatTranslatorSlots: new Set(),
    chatTranslatorScheduler: { setWorkerCount: () => {} },
    autoScaleTarget,
    autoScaleDrainTarget,
    desiredChatAgentWorkerSlots: 2,
    configuredChatAgentWorkerSlots: 2,
    chatAgentWorkerLastGrowAt: 0,
    CHAT_AGENT_AUTO_SCALE_DRAIN_COOLDOWN_MS: 20_000,
    chatAgentKeepFlowingFloor: () => 0,
    setChatAgentWorkerTarget: (count) => { context.desiredChatAgentWorkerSlots = count },
    publishChatAgentRuntimeState: () => {},
    console: { log() {}, warn(message) { warnings.push(message) } },
  }
  await vm.runInNewContext(`${fn}; reconcileChatAgentAutoScale()`, context)
  assert.deepEqual(warnings, [])
  assert.equal(context.desiredChatAgentWorkerSlots, 4)
})

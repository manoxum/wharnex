import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChatAgentRuntimeState } from './runtime-snapshot.mjs'

function dependencies() {
  const supervisor = { ownerKey: 'chat-a', loading: false }
  const worker = { slotId: 'worker-1', ownerKey: 'chat-b', loading: false }
  const browser = () => ({ available: false })
  return {
    chatAgentPolicies: { workers_suspended: false, keep_flowing_global: false, keep_flowing_workers: [] },
    desiredChatAgentSupervisorSlots: 1, desiredChatAgentWorkerSlots: 1,
    configuredChatAgentSupervisorSlots: 1, configuredChatAgentWorkerSlots: 1,
    chatSupervisorSlotID: () => 'supervisor-1', supervisorKeyForSlot: () => 'chat-a',
    chatgptViews: new Map([['chat-a', supervisor]]), desktopWindows: new Map(),
    chatSupervisorStates: new Map([[1, { active: true, task: { chat_id: 'chat-a', project_id: 'project-a', status: 'RUNNING' } }]]),
    sanitizeOptionalChatCacheKey: (value) => value || '', supervisorBindingHold: () => 'awaiting-response',
    chatGPTWorkerEntries: [worker], chatAgentWorkerStates: new Map([[1, { active: true, lastTask: { project_id: 'project-b' } }]]),
    chatAgentKeepFlowingActive: () => true, chatAgentKeepFlowingConfigured: () => false,
    orchestrationTaskPins: { taskId: () => '' }, chatAgentResidency: { snapshot: () => ({}) },
    chatAgentWorkerActivity: { snapshot: () => null }, EPHEMERAL_AGENT_ID: /^utility-/,
    EPHEMERAL_WORKER_LABELS: {}, chatAgentScheduler: { instanceID: 'instance' },
    chatAgentRuntimeDiagnostics: { scheduler: {}, queue: {}, provider: {} },
    publicAgentBrowser: browser,
    chatAgentRuntimeMemory: () => ({ totals: {}, by_agent: {} }),
  }
}

test('snapshot keeps engaged slots occupied and attributed between leases', () => {
  const state = buildChatAgentRuntimeState(dependencies())
  assert.equal(state.agents[0].status, 'running')
  assert.equal(state.agents[0].occupied, true)
  assert.equal(state.agents[0].project_id, 'project-a')
  assert.equal(state.agents[1].status, 'claimed')
  assert.equal(state.agents[1].occupied, true)
  assert.equal(state.agents[1].project_id, 'project-b')
  assert.equal(state.agents[1].keep_flowing_active, true)
})

test('snapshot does not attribute an idle slot to its settled last task', () => {
  const deps = dependencies()
  deps.chatSupervisorStates.set(1, { active: true, lastTask: { project_id: 'project-a' } })
  deps.supervisorBindingHold = () => ''
  deps.chatAgentKeepFlowingActive = () => false
  const state = buildChatAgentRuntimeState(deps)
  assert.equal(state.agents[0].status, 'idle')
  assert.equal(state.agents[0].project_id, '')
  assert.equal(state.agents[1].status, 'idle')
  assert.equal(state.agents[1].project_id, '')
})

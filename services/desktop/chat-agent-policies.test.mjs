import assert from 'node:assert/strict'
import test from 'node:test'
import { HARD_MAX_SUPERVISOR_SLOTS, HARD_MAX_WORKER_SLOTS } from './chat-agent-pool.mjs'
import { autoScaleDrainTarget, autoScaleSupervisorDrainTarget, autoScaleSupervisorTarget, autoScaleTarget, keepFlowingForWorker, normalizeChatAgentPolicies } from './chat-agent-policies.mjs'

test('defaults global flow protection on and normalizes its bounded policy', () => {
  assert.deepEqual(normalizeChatAgentPolicies(), {
    auto_scale: true, auto_scale_max_supervisors: HARD_MAX_SUPERVISOR_SLOTS, auto_scale_max_workers: HARD_MAX_WORKER_SLOTS, keep_flowing_global: true, keep_flowing_workers: [],
  })
  assert.equal(normalizeChatAgentPolicies({ keep_flowing_global: false }).auto_scale, true)
  assert.deepEqual(normalizeChatAgentPolicies({ auto_scale: false, auto_scale_max_workers: 2, keep_flowing_global: false, keep_flowing_workers: ['worker-3', 'worker-2', 'worker-2', 'worker-99', 'bad'] }), {
    auto_scale: false, auto_scale_max_supervisors: HARD_MAX_SUPERVISOR_SLOTS, auto_scale_max_workers: 2, keep_flowing_global: false, keep_flowing_workers: ['worker-2', 'worker-3'],
  })
  assert.equal(normalizeChatAgentPolicies({ auto_scale_max_workers: 99 }).auto_scale_max_workers, HARD_MAX_WORKER_SLOTS)
  assert.equal(normalizeChatAgentPolicies({ auto_scale_max_workers: 0 }).auto_scale_max_workers, 1)
  assert.equal(keepFlowingForWorker({ keep_flowing_workers: ['worker-2'] }, 2), true)
  assert.equal(keepFlowingForWorker({ keep_flowing_global: true }, 'worker-3'), true)
})

test('auto scale fills unmet Worker demand up to the configured ceiling', () => {
  assert.equal(autoScaleTarget({ enabled: true, due: 2, available: 0, current: 2, maxWorkers: 6 }), 4)
  assert.equal(autoScaleTarget({ enabled: true, due: 2, available: 1, current: 2, maxWorkers: 6 }), 3)
  assert.equal(autoScaleTarget({ enabled: true, due: 1, available: 1, current: 2, maxWorkers: 6 }), 2)
  assert.equal(autoScaleTarget({ enabled: true, due: 5, available: 0, current: 4, maxWorkers: 6 }), 6)
  assert.equal(autoScaleTarget({ enabled: true, due: 2, available: 0, current: 6, maxWorkers: 4 }), 6)
  assert.equal(autoScaleTarget({ enabled: false, due: 2, available: 0, current: 2, maxWorkers: 6 }), 2)
})

test('auto scale drains extras back to the configured floor only after backlog clears', () => {
  assert.equal(autoScaleDrainTarget({ enabled: true, due: 0, configured: 2, current: 5 }), 2)
  assert.equal(autoScaleDrainTarget({ enabled: true, due: 0, configured: 2, current: 5, keepFlowingFloor: 4 }), 4)
  assert.equal(autoScaleDrainTarget({ enabled: true, due: 1, configured: 2, current: 5 }), 5)
})

test('supervisor auto scale fills unmet waiting lanes, never task count', () => {
  assert.equal(autoScaleSupervisorTarget({ enabled: true, dueLanes: 2, available: 0, current: 3, maxSupervisors: 12 }), 5)
  // One free slot serves one waiting lane; the second still needs capacity.
  assert.equal(autoScaleSupervisorTarget({ enabled: true, dueLanes: 2, available: 1, current: 3, maxSupervisors: 12 }), 4)
  assert.equal(autoScaleSupervisorTarget({ enabled: true, dueLanes: 1, available: 1, current: 3, maxSupervisors: 12 }), 3)
  // Supervisor-owned work stacked on one conversation is one lane, so the pool
  // stays put: a resident slot already serves all of it.
  assert.equal(autoScaleSupervisorTarget({ enabled: true, dueLanes: 0, available: 0, current: 3, maxSupervisors: 12 }), 3)
  assert.equal(autoScaleSupervisorTarget({ enabled: true, dueLanes: 5, available: 0, current: 6, maxSupervisors: 6 }), 6)
  assert.equal(autoScaleSupervisorTarget({ enabled: false, dueLanes: 5, available: 0, current: 3, maxSupervisors: 12 }), 3)
})

test('supervisor auto scale never drains the cap below the conversations still bound', () => {
  assert.equal(autoScaleSupervisorDrainTarget({ enabled: true, dueLanes: 0, configured: 3, current: 6, boundSupervisors: 0 }), 3)
  // Five conversations are resident: dropping the cap to three would make the
  // next chat switch a provider reload.
  assert.equal(autoScaleSupervisorDrainTarget({ enabled: true, dueLanes: 0, configured: 3, current: 6, boundSupervisors: 5 }), 5)
  assert.equal(autoScaleSupervisorDrainTarget({ enabled: true, dueLanes: 1, configured: 3, current: 6, boundSupervisors: 0 }), 6)
})

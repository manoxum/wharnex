import assert from 'node:assert/strict'
import test from 'node:test'
import { HARD_MAX_SUPERVISOR_SLOTS, HARD_MAX_WORKER_SLOTS } from './chat-agent-pool.mjs'
import { autoScaleDrainTarget, autoScaleTarget, keepFlowingForWorker, normalizeChatAgentPolicies } from './chat-agent-policies.mjs'

test('defaults global flow protection on and normalizes its bounded policy', () => {
  assert.deepEqual(normalizeChatAgentPolicies(), {
    auto_scale: true, auto_scale_max_supervisors: HARD_MAX_SUPERVISOR_SLOTS, auto_scale_max_workers: HARD_MAX_WORKER_SLOTS, keep_flowing_global: true, keep_flowing_workers: [],
  })
  assert.deepEqual(normalizeChatAgentPolicies({ auto_scale: false, auto_scale_max_workers: 2, keep_flowing_global: false, keep_flowing_workers: ['worker-3', 'worker-2', 'worker-2', 'worker-99', 'bad'] }), {
    auto_scale: false, auto_scale_max_supervisors: HARD_MAX_SUPERVISOR_SLOTS, auto_scale_max_workers: 2, keep_flowing_global: false, keep_flowing_workers: ['worker-2', 'worker-3'],
  })
  assert.equal(normalizeChatAgentPolicies({ auto_scale_max_workers: 99 }).auto_scale_max_workers, HARD_MAX_WORKER_SLOTS)
  assert.equal(normalizeChatAgentPolicies({ auto_scale_max_workers: 0 }).auto_scale_max_workers, 1)
  assert.equal(keepFlowingForWorker({ keep_flowing_workers: ['worker-2'] }, 2), true)
  assert.equal(keepFlowingForWorker({ keep_flowing_global: true }, 'worker-3'), true)
})

test('auto scale grows one slot only when due work has no available Worker', () => {
  assert.equal(autoScaleTarget({ enabled: true, due: 2, available: 0, current: 2, maxWorkers: 6 }), 3)
  assert.equal(autoScaleTarget({ enabled: true, due: 2, available: 1, current: 2, maxWorkers: 6 }), 2)
  assert.equal(autoScaleTarget({ enabled: true, due: 2, available: 0, current: 4, maxWorkers: 4 }), 4)
  assert.equal(autoScaleTarget({ enabled: true, due: 2, available: 0, current: 6, maxWorkers: 4 }), 6)
  assert.equal(autoScaleTarget({ enabled: false, due: 2, available: 0, current: 2, maxWorkers: 6 }), 2)
})

test('auto scale drains extras back to the configured floor only after backlog clears', () => {
  assert.equal(autoScaleDrainTarget({ enabled: true, due: 0, configured: 2, current: 5 }), 2)
  assert.equal(autoScaleDrainTarget({ enabled: true, due: 0, configured: 2, current: 5, keepFlowingFloor: 4 }), 4)
  assert.equal(autoScaleDrainTarget({ enabled: true, due: 1, configured: 2, current: 5 }), 5)
})

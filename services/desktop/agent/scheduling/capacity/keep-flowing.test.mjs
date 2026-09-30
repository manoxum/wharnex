import test from 'node:test'
import assert from 'node:assert/strict'
import { createKeepFlowingState } from './keep-flowing.mjs'

function fixture() {
  const workerStates = new Map()
  const pendingDeliveries = new Map()
  const expectedBundles = new Map()
  const deliveredIds = new Set()
  let policies = { keep_flowing_global: false, keep_flowing_workers: [] }
  const state = createKeepFlowingState({
    policies: () => policies,
    workerStates,
    workerCount: () => 2,
    delivered: (id) => deliveredIds.has(id),
    pendingDeliveries,
    expectedBundles,
  })
  return { state, workerStates, pendingDeliveries, expectedBundles, deliveredIds, setPolicies: (value) => { policies = value } }
}

test('task sponsorship stays active across WAITING but ends on delivery or attention', () => {
  const { state, workerStates, expectedBundles, pendingDeliveries, deliveredIds } = fixture()
  const task = { request_id: 'request-1', keep_flowing: true }
  workerStates.set(1, { lastTask: task, lastResult: { status: 'WAITING' } })
  expectedBundles.set('chat', { requestId: 'request-1' })
  assert.equal(state.active(1), true)
  assert.equal(state.requestActive('request-1'), true)

  pendingDeliveries.set('request-1', {})
  assert.equal(state.active(1), false)
  assert.equal(state.requestActive('request-1'), false)
  pendingDeliveries.clear()
  deliveredIds.add('request-1')
  assert.equal(state.active(1), false)
  deliveredIds.clear()
  workerStates.set(1, { lastTask: task, lastResult: { status: 'ATTENTION' } })
  assert.equal(state.active(1), false)
})

test('current sponsored task and configured Worker can keep a live response active', () => {
  const { state, workerStates, expectedBundles, setPolicies } = fixture()
  workerStates.set(1, { task: { root_request_id: 'root-1', keep_flowing: true } })
  expectedBundles.set('chat', { requestId: 'root-1' })
  assert.equal(state.active(1), true)
  assert.equal(state.enabled(1), true)
  assert.equal(state.requestActive('root-1'), true)
  workerStates.set(2, { task: { request_id: 'root-2' } })
  expectedBundles.set('chat-2', { requestId: 'root-2' })
  setPolicies({ keep_flowing_global: false, keep_flowing_workers: ['worker-2'] })
  assert.equal(state.configured(2), true)
  assert.equal(state.active(2), true)
  assert.equal(state.active(1), true)
})

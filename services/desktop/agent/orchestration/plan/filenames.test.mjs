import assert from 'node:assert/strict'
import test from 'node:test'
import { orchestratorPlanFilename, orchestratorBundleFilename, orchestratorDeliveryFor } from './filenames.mjs'

test('Orchestrator filenames preserve new bundle and legacy checkpoint contracts', () => {
  const taskID = `cat_${'a'.repeat(20)}`
  const requestID = `orp_20260930T123456_${'b'.repeat(16)}`
  assert.equal(orchestratorPlanFilename(taskID), `whx_orchestrator_plan_${taskID}.json`)
  assert.equal(orchestratorBundleFilename(requestID), `whx_bundle_res_orchestrator_${requestID}.zip`)
  assert.equal(orchestratorDeliveryFor('old.json'), 'json')
  assert.equal(orchestratorDeliveryFor('new.zip'), 'bundle')
  assert.throws(() => orchestratorBundleFilename(taskID), /invalid orchestrator request id/)
})

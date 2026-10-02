import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EPHEMERAL_WORKER_TASK_TYPES, EPHEMERAL_AGENT_ID,
  EPHEMERAL_WORKER_IDLE_RETIRE_MS,
} from './ephemeral-config.mjs'

test('utility slots retain dedicated task types and canonical agent ids', () => {
  assert.deepEqual([...EPHEMERAL_WORKER_TASK_TYPES], ['TRANSLATE_MARKDOWN', 'ORCHESTRATOR_PLAN', 'RELEASE_NOTES', 'UI_TEST_DISCOVER', 'UI_TEST_RUN'])
  assert.equal(EPHEMERAL_AGENT_ID.test(`translator-cat_${'a'.repeat(20)}`), true)
  assert.equal(EPHEMERAL_AGENT_ID.test('worker-1'), false)
  assert.equal(EPHEMERAL_WORKER_IDLE_RETIRE_MS, 20 * 60_000)
})

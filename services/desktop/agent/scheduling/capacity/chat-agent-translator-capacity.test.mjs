import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_TRANSLATOR_SLOTS, translatorCapacityTarget } from './chat-agent-translator-capacity.mjs'

test('every due ephemeral task gets a loop while running ones keep theirs', () => {
  assert.equal(translatorCapacityTarget({ due: 0, active: 0 }), 1)
  assert.equal(translatorCapacityTarget({ due: 3, active: 0 }), 3)
  assert.equal(translatorCapacityTarget({ due: 2, active: 3 }), 5)
  // Free Orchestrator execution Workers are not capacity for these tasks.
  assert.equal(translatorCapacityTarget({ due: 3, active: 1, availableWorkers: 2 }), 4)
  assert.equal(translatorCapacityTarget({ due: 2, active: 0, availableWorkers: 2 }), 2)
  assert.equal(translatorCapacityTarget({ due: 0, active: 3 }), 3)
  assert.equal(translatorCapacityTarget({ due: 0, active: 0 }), 1)
})

test('translator capacity respects the backend canonical agent id bound', () => {
  assert.equal(translatorCapacityTarget({ due: 100, active: 1 }), MAX_TRANSLATOR_SLOTS)
  assert.equal(translatorCapacityTarget({ due: -1, active: -2 }), 1)
})

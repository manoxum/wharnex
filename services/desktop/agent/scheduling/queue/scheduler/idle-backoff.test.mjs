import assert from 'node:assert/strict'
import test from 'node:test'
import { chatAgentIdleDelay, DEFAULT_CHAT_AGENT_IDLE_CEILING_MS } from './idle-backoff.mjs'

test('empty claims back off exponentially up to the ceiling', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((streak) => chatAgentIdleDelay(streak, 750)), [750, 1500, 3000, 3000, 3000])
  assert.equal(chatAgentIdleDelay(100, 750), DEFAULT_CHAT_AGENT_IDLE_CEILING_MS)
})

test('a ceiling below the base never shortens the configured idle wait', () => {
  assert.equal(chatAgentIdleDelay(3, 10_000), 10_000)
  assert.equal(chatAgentIdleDelay(0, 1), 1)
})

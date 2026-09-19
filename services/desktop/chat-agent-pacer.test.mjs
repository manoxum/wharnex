import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, CHAT_AGENT_WORKER_ACTION_GAP_MS, ChatAgentGlobalPacer } from './chat-agent-pacer.mjs'

test('all ordinary Worker actions share a 30-second global cadence', async () => {
  let now = 1
  const started = []
  const pacer = new ChatAgentGlobalPacer({ now: () => now, wait: async (ms) => { now += ms } })
  await Promise.all([0, 1, 2].map(async () => {
    started.push(await pacer.pace(() => 0))
  }))
  assert.deepEqual(started, [1, 30_001, 60_001])
  assert.equal(CHAT_AGENT_WORKER_ACTION_GAP_MS, 30_000)
})

test('translation Worker actions retain their separately bounded five-second cadence', async () => {
  let now = 1
  const started = []
  const pacer = new ChatAgentGlobalPacer({ now: () => now, wait: async (ms) => { now += ms } })
  await Promise.all([0, 1, 2].map(async () => {
    started.push(await pacer.pace(() => 0, { minimumGapMs: CHAT_AGENT_TRANSLATION_ACTION_GAP_MS }))
  }))
  assert.deepEqual(started, [1, 5_001, 10_001])
  assert.equal(CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, 5_000)
})

test('provider pressure can only widen the shared Worker cadence', async () => {
  let now = 1
  const started = []
  const pacer = new ChatAgentGlobalPacer({ now: () => now, wait: async (ms) => { now += ms } })
  started.push(await pacer.pace(() => 0))
  started.push(await pacer.pace(() => 45_000, { minimumGapMs: CHAT_AGENT_TRANSLATION_ACTION_GAP_MS }))
  assert.deepEqual(started, [1, 45_001])
})

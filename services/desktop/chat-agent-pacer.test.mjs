import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_AGENT_TRANSLATION_ACTION_GAP_MS, CHAT_AGENT_WORKER_ACTION_GAP_MS, ChatAgentGlobalPacer } from './chat-agent-pacer.mjs'

test('all ordinary Worker actions share a 10-second global cadence', async () => {
  let now = 1
  const started = []
  const pacer = new ChatAgentGlobalPacer({ now: () => now, wait: async (ms) => { now += ms } })
  await Promise.all([0, 1, 2].map(async () => {
    started.push(await pacer.pace(() => 0))
  }))
  assert.deepEqual(started, [1, 10_001, 20_001])
  assert.equal(CHAT_AGENT_WORKER_ACTION_GAP_MS, 10_000)
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

test('an in-flight task action takes the next slot ahead of queued new-task actions', async () => {
  let now = 1
  const order = []
  const pacer = new ChatAgentGlobalPacer({ now: () => now, wait: async (ms) => { now += ms } })
  await pacer.pace(() => 0)
  const queued = [
    pacer.pace(() => 0).then((at) => order.push(['new-a', at])),
    pacer.pace(() => 0).then((at) => order.push(['new-b', at])),
    pacer.pace(() => 0, { priority: 1 }).then((at) => order.push(['upload', at])),
  ]
  await Promise.all(queued)
  // Priority reorders only; the shared gap between any two actions is unchanged.
  assert.deepEqual(order, [['upload', 10_001], ['new-a', 20_001], ['new-b', 30_001]])
})

test('a higher-priority action arriving during a wait is served before the older waiter', async () => {
  let now = 1
  const order = []
  let arrive
  const pacer = new ChatAgentGlobalPacer({
    now: () => now,
    wait: async (ms) => { if (arrive) { const late = arrive; arrive = undefined; late() } now += ms },
  })
  await pacer.pace(() => 0)
  arrive = () => pacer.pace(() => 0, { priority: 1 }).then((at) => order.push(['upload', at]))
  const first = pacer.pace(() => 0).then((at) => order.push(['new', at]))
  await first
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(order.map(([name]) => name), ['upload', 'new'])
  assert.equal(order[1][1] - order[0][1], 10_000)
})

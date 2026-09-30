import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createChatAgentRuntimeControls } from './controls.mjs'

test('runtime state returns synchronously while broadcasts coalesce to the latest value', async () => {
  let version = 0
  const delivered = []
  const controls = createChatAgentRuntimeControls({
    getRuntimeState: () => ({ version: ++version }),
    desktopWindows: new Map([['window', { id: 'window' }]]),
    sendToWindowState: (_window, _channel, state) => delivered.push(state.version),
    refreshDesktopTray: () => {}, broadcastDelayMs: 5,
    state: { policies: {}, scheduler: undefined },
    normalizeChatAgentPolicies: (value) => value,
    persistChatAgentPolicies: () => {},
  })
  assert.equal(controls.publishChatAgentRuntimeState().version, 1)
  assert.equal(controls.publishChatAgentRuntimeState().version, 2)
  assert.equal(controls.publishChatAgentRuntimeState().version, 3)
  assert.deepEqual(delivered, [1])
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.deepEqual(delivered, [1, 3])
})

test('Worker pause and resume persist policy changes and wake the scheduler', () => {
  const events = []
  const state = { policies: {}, scheduler: { wake: () => events.push('wake') } }
  const controls = createChatAgentRuntimeControls({
    getRuntimeState: () => state.policies, desktopWindows: new Map(),
    sendToWindowState: () => {}, refreshDesktopTray: () => {},
    broadcastDelayMs: 5, state, normalizeChatAgentPolicies: (value) => value,
    persistChatAgentPolicies: () => events.push('persist'),
  })
  assert.throws(() => controls.pauseChatAgentWorkers({ pausedUntil: 'invalid' }), /invalid/)
  controls.pauseChatAgentWorkers({ taskTypes: ['BOT_WRITE'] })
  assert.equal(state.policies.workers_suspended, true)
  assert.deepEqual(state.policies.workers_suspended_types, ['BOT_WRITE'])
  controls.resumeChatAgentWorkers()
  assert.equal(state.policies.workers_suspended, false)
  assert.deepEqual(events, ['persist', 'wake', 'persist', 'wake'])
})

test('runtime controls initialize before early Desktop consumers capture them', async () => {
  const main = await readFile(new URL('../../../main.mjs', import.meta.url), 'utf8')
  const initialized = main.indexOf('createChatAgentRuntimeControls({')
  assert.ok(initialized > 0)
  assert.ok(initialized < main.indexOf('resumeWorkers: resumeChatAgentWorkers'))
  assert.ok(initialized < main.indexOf('refreshChatAgentRuntimeState, publishChatAgentRuntimeState,'))
  assert.match(main, /persistChatAgentPolicies: \(\.\.\.args\) => persistChatAgentPolicies\(\.\.\.args\)/)
})

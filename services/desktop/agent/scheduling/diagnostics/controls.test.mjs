import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createChatAgentRuntimeControls } from './controls.mjs'
import { readDesktopCompositionSource } from '../../../composition/entry/source.mjs'
import { CHAT_AGENT_WORKER_TASK_TYPES, normalizeChatAgentPolicies } from '../capacity/chat-agent-policies.mjs'

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
  const main = await readDesktopCompositionSource()
  const windowRuntime = await readFile(new URL('../../../composition/window/runtime.mjs', import.meta.url), 'utf8')
  const windowAssembly = await readFile(new URL('../../../composition/window/assembly/runtime.mjs', import.meta.url), 'utf8')
  const initialized = main.indexOf('createChatAgentRuntimeControls({')
  assert.ok(initialized > 0)
  assert.ok(initialized < main.indexOf("compose(ctx, 'window-assembly'"))
  assert.match(windowAssembly, /createDesktopWindowRuntime\(\{/)
  assert.match(windowRuntime, /resumeWorkers: d\.resumeChatAgentWorkers/)
  assert.ok(initialized < main.indexOf("compose(ctx, 'agent-task-queue'"))
  assert.match(main, /persistChatAgentPolicies: deferred\.persistChatAgentPolicies/)
})

function migrationControls(policies, setAutomationHold) {
  const holds = []
  let persisted = 0
  const state = {
    policies: normalizeChatAgentPolicies(policies),
    scheduler: setAutomationHold === null ? undefined : { wake: () => {}, setAutomationHold: setAutomationHold || (async (name, hold) => { holds.push([name, hold]) }) },
  }
  const runtime = createChatAgentRuntimeControls({
    getRuntimeState: () => ({}), desktopWindows: new Map(), sendToWindowState: () => {}, refreshDesktopTray: () => {},
    broadcastDelayMs: 1, state, normalizeChatAgentPolicies, persistChatAgentPolicies: () => { persisted += 1 },
  })
  return { runtime, state, holds, persisted: () => persisted }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

test('a per-type Worker suspension moves to the backend task holds exactly once', async () => {
  const until = new Date(Date.now() + 60 * 60_000).toISOString()
  const { runtime, state, holds, persisted } = migrationControls({ workers_suspended: true, workers_suspended_until: until, workers_suspended_types: ['RENAME_CHAT', 'UI_TEST_RUN'] })
  runtime.publishChatAgentRuntimeState()
  await settle()
  assert.equal(holds.length, CHAT_AGENT_WORKER_TASK_TYPES.length, 'every Worker type is written, held or not')
  const byName = Object.fromEntries(holds)
  assert.deepEqual(byName['task:RENAME_CHAT'], { active: true, until, reason: 'Migrado da suspensão por tipo dos Workers', source: 'desktop-migration' })
  assert.equal(byName['task:UI_TEST_RUN'].active, true)
  assert.deepEqual(byName['task:TODO_CLASSIFY'], { active: false })
  assert.equal(state.policies.task_holds_migrated, true)
  assert.equal(state.policies.workers_suspended, false)
  assert.deepEqual(state.policies.workers_suspended_types, [])
  assert.equal(persisted(), 1)
  runtime.publishChatAgentRuntimeState()
  await settle()
  assert.equal(holds.length, CHAT_AGENT_WORKER_TASK_TYPES.length, 'a migrated Desktop never writes again')
})

test('a whole-pool suspension stays local and an unreachable backend retries later', async () => {
  const { runtime, state, holds } = migrationControls({ workers_suspended: true, workers_suspended_types: [] })
  runtime.publishChatAgentRuntimeState()
  await settle()
  assert.ok(holds.every(([, hold]) => hold.active === false))
  assert.equal(state.policies.workers_suspended, true, 'the whole-pool switch is not a per-type hold')
  let calls = 0
  const failing = migrationControls({ workers_suspended: true, workers_suspended_types: ['RENAME_CHAT'] }, async () => { calls += 1; throw new Error('backend down') })
  failing.runtime.publishChatAgentRuntimeState()
  await settle()
  assert.equal(failing.state.policies.task_holds_migrated, false)
  assert.deepEqual(failing.state.policies.workers_suspended_types, ['RENAME_CHAT'], 'nothing is cleared before the holds exist')
  failing.runtime.publishChatAgentRuntimeState()
  await settle()
  assert.equal(calls, 2)
})

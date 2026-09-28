import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stepChatGPTEffort } from './chatgpt-effort-interaction.mjs'

function fakeControl(visible = false) {
  const commands = []
  let attached = false
  const wc = { debugger: {
    isAttached: () => attached,
    attach: () => { attached = true; commands.push('attach') },
    detach: () => { attached = false; commands.push('detach') },
    sendCommand: async (name, args) => { commands.push(`${name}:${String(args?.enabled)}`) },
  } }
  return { commands, wc, entry: { view: { getVisible: () => visible } } }
}

test('hidden Worker enables focused page input only for the trusted effort interaction', async () => {
  const { commands, wc, entry } = fakeControl()
  let opened = false
  const keys = []
  await stepChatGPTEffort({
    key: 'owned-worker', entry, wanted: 'instant', behavior: {},
    executeDOM: async (_key, _entry, operation) => operation === 'reasoning-effort-state'
      ? { ok: true, effort: 'high' }
      : opened ? { ok: true, state: 'effort-slider-ready' }
        : { ok: true, state: 'effort-menu-closed', rect: { x: 10, y: 20 } },
    requireOwned: () => ({ wc }),
    press: async () => { assert.ok(commands.includes('Emulation.setFocusEmulationEnabled:true')); opened = true; return { x: 10, y: 20 } },
    pressKey: async (_entry, _wc, key) => { keys.push(key) },
    wait: async () => {}, settleMs: 0, reopenAttempts: 3, log: () => {},
  })
  assert.deepEqual(keys, ['Left', 'Escape'])
  assert.deepEqual(commands, ['attach', 'Emulation.setFocusEmulationEnabled:true', 'Emulation.setFocusEmulationEnabled:false', 'detach'])
})

test('failed hidden effort opening clears focus emulation and debugger attachment', async () => {
  const { commands, wc, entry } = fakeControl()
  await assert.rejects(stepChatGPTEffort({
    key: 'owned-worker', entry, wanted: 'instant', behavior: {},
    executeDOM: async (_key, _entry, operation) => operation === 'reasoning-effort-state'
      ? { ok: true, effort: 'high' }
      : { ok: true, state: 'effort-menu-closed', rect: { x: 10, y: 20 } },
    requireOwned: () => ({ wc }), press: async () => ({ x: 10, y: 20 }),
    pressKey: async () => {}, wait: async () => {}, settleMs: 0, reopenAttempts: 1, log: () => {},
  }), /slider is unavailable/)
  assert.deepEqual(commands.slice(-2), ['Emulation.setFocusEmulationEnabled:false', 'detach'])
})

test('effort control scripts stay composer-scoped and do not synthesize clicks', async () => {
  const source = await readFile(new URL('./chat-agent-reasoning-effort-scripts.mjs', import.meta.url), 'utf8')
  assert.match(source, /button\[0\]\.focus\(\)/)
  assert.match(source, /slider\.focus\(\)/)
  assert.match(source, /getAttribute\('aria-valuenow'\)/)
  assert.doesNotMatch(source, /\.click\(\)/)
  const main = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const interaction = await readFile(new URL('./chatgpt-effort-interaction.mjs', import.meta.url), 'utf8')
  assert.match(interaction, /const pressed = await press\(entry, wc, staged\.rect\)/)
  assert.match(interaction, /await pressKey\(entry, wc, direction\)/)
  assert.match(interaction, /withWorkerPageInput\(entry, wc, async \(\) =>/)
  assert.match(main, /press: pressChatGPTControl, pressKey: pressChatGPTControlKey/)
  assert.match(main, /await stepChatGPTReasoningEffortToward\(key, target\.entry, reasoningEffort\)/)
  assert.doesNotMatch(main, /dispatchChatGPTEffortCycle/)
})

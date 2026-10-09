import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTModelSelection } from './selection.mjs'

function fixture({ options, selected = 'alpha', unavailable = false } = {}) {
  let current = selected
  const events = []
  const entry = { ownerKey: 'chat', view: { webContents: {} } }
  const rows = options || [{ id: 'alpha', label: 'Account Alpha', disabled: false }, { id: 'beta', label: 'Account Beta', disabled: false }]
  const context = {
    requireOwnedChatGPTEntry: () => ({ wc: entry.view.webContents }),
    executeChatGPTDOMScript: async (_key, _entry, stage) => {
      events.push(stage)
      if (unavailable) return { ok: false, state: 'model-control-unavailable' }
      if (stage === 'model-open') return { ok: true, state: 'model-menu-closed', rect: { x: 1, y: 1 } }
      if (stage === 'model-locate') return { ok: true, state: 'model-option-ready', rect: { x: 2, y: 2 }, option: { id: 'beta', disabled: false } }
      return { ok: true, state: 'model-menu-read', options: rows.map((row, index) => ({ ...row, index, selected: row.id === current })) }
    },
    pressChatGPTControl: async (_entry, _wc, rect) => { events.push('native-press'); if (rect.x === 2) current = 'beta' },
    pressChatGPTControlKey: async (_entry, _wc, key) => events.push(key),
    wait: async () => {},
  }
  return { models: createChatGPTModelSelection(context), events, entry }
}

test('model inventory comes from account options and selects with native input then verifies', async () => {
  const f = fixture()
  const result = await f.models.select('chat', f.entry, 'beta')
  assert.equal(result.current, 'beta')
  assert.deepEqual(result.options.map((option) => option.label), ['Account Alpha', 'Account Beta'])
  assert.equal(f.events.filter((event) => event === 'native-press').length, 3)
})

test('disabled, absent or ambiguous model choices cannot be committed', async () => {
  for (const rows of [
    [{ id: 'beta', label: 'Account Beta', disabled: true }],
    [{ id: 'alpha', label: 'Account Alpha', disabled: false }],
    [{ id: 'beta', label: 'Account Beta', disabled: false }, { id: 'beta', label: 'Duplicate', disabled: false }],
  ]) {
    const f = fixture({ options: rows })
    await assert.rejects(f.models.select('chat', f.entry, 'beta'), /modelo|model/i)
    assert.equal(f.events.includes('model-locate'), false)
  }
})

test('verification after upload refuses a changed model instead of silently switching it', async () => {
  const f = fixture()
  await assert.rejects(f.models.ensure('chat', f.entry, 'beta', { allowChange: false }), /modelo|model/i)
  assert.equal(f.events.includes('model-locate'), false)
})

test('hidden model inventory owns input emulation for the entire interaction and restores it on failure', async () => {
  for (const unavailable of [false, true]) {
    const f = fixture({ unavailable })
    const commands = []
    const wc = f.entry.view.webContents
    f.entry.view.getVisible = () => false
    wc.debugger = { isAttached: () => false, attach: () => commands.push('attach'), detach: () => commands.push('detach'), sendCommand: async (name, value) => commands.push(`${name}:${value.enabled}`) }
    if (unavailable) await assert.rejects(f.models.inventory('chat', f.entry), /Modelo ChatGPT indisponível/)
    else assert.equal((await f.models.inventory('chat', f.entry)).current, 'alpha')
    assert.deepEqual(commands, ['attach', 'Emulation.setFocusEmulationEnabled:true', 'Emulation.setFocusEmulationEnabled:false', 'detach'])
  }
})

test('menu reordering after discovery cannot select a different account model', async () => {
  const f = fixture()
  // A second instance returns a changed identity at the locate boundary.
  const changed = createChatGPTModelSelection({
    requireOwnedChatGPTEntry: () => ({ wc: f.entry.view.webContents }),
    executeChatGPTDOMScript: async (_key, _entry, stage) => stage === 'model-locate'
      ? { ok: true, rect: { x: 1, y: 1 }, option: { id: 'other', disabled: false } }
      : { ok: true, state: 'model-menu-read', options: [{ id: 'beta', label: 'Account Beta', disabled: false }] },
    pressChatGPTControl: async () => f.events.push('wrong-press'),
    pressChatGPTControlKey: async () => {}, wait: async () => {},
  })
  await assert.rejects(changed.select('chat', f.entry, 'beta'), /model-option-changed/)
  assert.deepEqual(f.events, [])
})


test('a missing model control causes no native input, including no unrelated Escape', async () => {
  const f = fixture({ unavailable: true })
  await assert.rejects(f.models.inventory('chat', f.entry), /model-control-unavailable/)
  assert.deepEqual(f.events, ['model-open'])
  const selection = fixture({ unavailable: true })
  await assert.rejects(selection.models.select('chat', selection.entry, 'beta'), /model-control-unavailable/)
  assert.deepEqual(selection.events, ['model-open'])
})

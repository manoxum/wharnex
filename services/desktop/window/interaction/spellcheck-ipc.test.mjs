import test from 'node:test'
import assert from 'node:assert/strict'
import { registerSpellcheckIPC } from './spellcheck-ipc.mjs'

test('spellcheck IPC clamps the trusted pointer and detaches its temporary debugger', async () => {
  const commands = []
  let attached = false
  let focused = false
  let handler
  const windowState = { window: {
    getContentSize: () => [100, 50], focus: () => { focused = true },
    webContents: { debugger: {
      isAttached: () => attached,
      attach: () => { attached = true },
      detach: () => { attached = false },
      sendCommand: async (_name, args) => { commands.push(args) },
    } },
  } }
  registerSpellcheckIPC({ ipcMain: { handle: (_name, value) => { handler = value } }, trustedSender: () => windowState })
  await assert.rejects(handler({}, { x: Number.NaN, y: 2 }), /Invalid spellcheck context-menu point/)
  assert.equal(focused, false)
  assert.deepEqual(await handler({}, { x: 150, y: -3 }), { ok: true })
  assert.equal(focused, true)
  assert.equal(attached, false)
  assert.deepEqual(commands.map(({ type, x, y }) => [type, x, y]), [
    ['mouseMoved', 99, 0], ['mousePressed', 99, 0], ['mouseReleased', 99, 0],
  ])
})

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { registerClipboardIPC } from './ipc.mjs'

test('clipboard IPC validates sender and bounds text writes', async () => {
  const handlers = new Map()
  let written = ''
  registerClipboardIPC({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    trustedSender: (event) => {
      if (!event?.trusted) throw new Error('untrusted sender')
    },
    clipboard: { readText: () => 'existing', writeText: async (value) => { written = value } },
  })
  const write = handlers.get('wharness:clipboard:write-text')
  await assert.rejects(write({}, 'secret'), /untrusted sender/)
  await assert.rejects(write({ trusted: true }, 'x'.repeat(4 * 1024 * 1024 + 1)), /4 MiB limit/)
  assert.equal(written, '')
  assert.deepEqual(await write({ trusted: true }, 'hello'), { ok: true })
  assert.equal(written, 'hello')
  assert.equal(handlers.get('wharness:clipboard:read-text')({ trusted: true }), 'existing')
})

test('context copy writes private ZIP bytes and passes its file URL to the clipboard', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'wharnex-clipboard-ipc-'))
  const handlers = new Map()
  let items
  class ClipboardItem {
    constructor(value) { this.value = value }
  }
  try {
    registerClipboardIPC({
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      trustedSender: () => undefined,
      clipboard: { write: async (value) => { items = value } },
      ClipboardItem,
      app: { getPath: () => temp },
      fetchContextZip: async () => ({ id: 'session-1', bytes: Buffer.from('ZIP') }),
    })
    const result = await handlers.get('wharness:clipboard:copy-context-zip')({}, { sessionId: 'session-1' })
    const copied = path.join(temp, 'wharness-context', 'session-1', 'wharness-context-session-1.zip')
    assert.deepEqual(result, { ok: true, bytes: 3 })
    assert.equal((await readFile(copied)).toString(), 'ZIP')
    assert.equal(items[0].value['text/uri-list'], new URL('file://' + copied).href + '\r\n')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

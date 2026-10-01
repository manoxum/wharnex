import assert from 'node:assert/strict'
import test from 'node:test'
import { registerBrowserDataIPC } from './ipc.mjs'

test('browser data IPC requires a trusted sender and explicit reset confirmation', async () => {
  const handlers = new Map()
  let cleared = 0
  registerBrowserDataIPC({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    trustedSender: (event) => {
      if (!event?.trusted) throw new Error('untrusted sender')
      return { id: 'window-1' }
    },
    desktopStorageUsage: () => ({ bytes: 7 }),
    exportBrowserSession: (state) => state.id,
    importBrowserSession: (state) => state.id,
    clearBrowserSession: () => ({ ok: true }),
    clearDesktopWharnexData: () => { cleared++; return { ok: true } },
  })
  const reset = handlers.get('wharness:data:clear-all')
  await assert.rejects(reset({}, { confirm: 'APAGAR WHARNEX' }), /untrusted sender/)
  await assert.rejects(reset({ trusted: true }, { confirm: 'APAGAR' }), /confirmation mismatch/)
  assert.equal(cleared, 0)
  assert.deepEqual(await reset({ trusted: true }, { confirm: 'APAGAR WHARNEX' }), { ok: true })
  assert.equal(cleared, 1)
  assert.equal(await handlers.get('wharness:data:export-browser-session')({ trusted: true }), 'window-1')
})

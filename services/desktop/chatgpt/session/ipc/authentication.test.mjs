import assert from 'node:assert/strict'
import test from 'node:test'
import { registerChatGPTAuthenticationIPC } from './authentication.mjs'

test('opening ChatGPT externally uses an owned browser instead of the host default browser', async () => {
  const handlers = new Map()
  const opened = []
  registerChatGPTAuthenticationIPC({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    trustedSender: () => ({ id: 'window' }),
    requireTrustedChatGPTURL: (url) => url,
    homeURL: 'https://chatgpt.com/',
    openOwnedChatGPTBrowser: async (url) => opened.push(url),
    shell: { openExternal: () => assert.fail('the host default browser bypasses up-whx-link') },
  })
  const result = await handlers.get('wharness:chatgpt:open-external')({}, { url: 'https://chatgpt.com/c/owned' })
  assert.deepEqual(opened, ['https://chatgpt.com/c/owned'])
  assert.deepEqual(result, { ok: true })
})

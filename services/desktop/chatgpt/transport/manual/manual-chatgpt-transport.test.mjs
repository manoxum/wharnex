import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createManualChatGPTTransport } from './manual-chatgpt-transport.mjs'

function fakeWebContents() {
  const events = new EventEmitter()
  let attached = false
  const commands = []
  const debuggerAPI = {
    attach() { attached = true },
    detach() { attached = false },
    isAttached() { return attached },
    on: (...args) => events.on(...args),
    removeListener: (...args) => events.removeListener(...args),
    async sendCommand(method, params) { commands.push({ method, params }); return {} },
  }
  return { isDestroyed: () => false, debugger: debuggerAPI, events, commands }
}

class FakeClipboardItem {
  constructor(data) { this.data = data }
}

test('manual request bundles arm the next user file picker and are injected once', async () => {
  const wc = fakeWebContents()
  const manager = createManualChatGPTTransport({ clipboard: { write: async () => {} }, ClipboardItem: FakeClipboardItem })
  await manager.prepare('chat-a', { requestId: 'req-a', files: ['/tmp/a.zip', '/tmp/b.zip'], filenames: ['a.zip', 'b.zip'], bytes: 42, prompt: 'Read the bundle.' }, wc)

  assert.equal(manager.publicState('chat-a').pickerArmed, true)
  wc.events.emit('message', {}, 'Page.fileChooserOpened', { backendNodeId: 77 })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(wc.commands.find((command) => command.method === 'DOM.setFileInputFiles')?.params, { backendNodeId: 77, files: ['/tmp/a.zip', '/tmp/b.zip'] })
  assert.equal(manager.publicState('chat-a').pickerAttached, true)
  assert.equal(manager.publicState('chat-a').pickerArmed, false)
  assert.equal(manager.publicState('chat-a').prompt, 'Read the bundle.')
})

test('manual request bundles can be copied as file URIs and are cleared on scraper mode', async () => {
  const writes = []
  const manager = createManualChatGPTTransport({ clipboard: { write: async (items) => writes.push(items) }, ClipboardItem: FakeClipboardItem })
  await manager.prepare('chat-a', { requestId: 'req-a', files: ['/tmp/a.zip'], filenames: ['a.zip'], bytes: 12 }, fakeWebContents())

  const result = await manager.copyPendingBundles('chat-a', 'req-a')
  assert.deepEqual(result, { ok: true, count: 1, filenames: ['a.zip'] })
  assert.match(writes[0][0].data['text/uri-list'], /^file:\/\/\/tmp\/a\.zip\r\n$/)

  await manager.setMode('chat-a', 'scraper')
  assert.equal(manager.publicState('chat-a'), undefined)
})

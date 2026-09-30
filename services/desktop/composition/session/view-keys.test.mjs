import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTViewKeys } from './index.mjs'

test('resolves only currently owned supervisor and worker entries', () => {
  const supervisor = { ownerKey: 'chat-1', view: { webContents: { id: 1 } } }
  const worker = { ownerKey: 'chat-2', role: 'worker', view: { webContents: { id: 2 } } }
  const views = new Map([['chat-1', supervisor]])
  const workers = [worker]
  const keys = createChatGPTViewKeys({ chatgptViews: views, chatGPTWorkerEntries: workers })
  assert.equal(keys.chatGPTKeyForEntry(supervisor), 'chat-1')
  assert.equal(keys.chatGPTKeyForEntry(worker), 'chat-2')
  assert.equal(keys.chatGPTKeyForWebContents({ id: 2 }), 'chat-2')
  views.delete('chat-1')
  workers.pop()
  assert.equal(keys.chatGPTKeyForEntry(supervisor), '')
  assert.equal(keys.chatGPTKeyForEntry(worker), '')
  assert.equal(keys.chatGPTKeyForWebContents({ id: 2 }), '')
})

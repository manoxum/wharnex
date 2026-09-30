import test from 'node:test'
import assert from 'node:assert/strict'
import { registerChatGPTLifecycleIPC } from './lifecycle.mjs'

function handlers(options = {}) {
  const registered = new Map()
  const calls = []
  registerChatGPTLifecycleIPC({
    ipcMain: { handle: (channel, handler) => registered.set(channel, handler) },
    trustedSender: () => ({ id: 1 }),
    enqueueChatAgentLifecycleTask: async (type, request) => { calls.push([type, request]); return { ok: true } },
    ensureChatGPTView: () => ({ key: 'chat-1', entry: {} }),
    requireOwnedChatGPTEntry: () => ({ wc: {} }),
    stopChatGPTConversation: async () => ({ stopped: true }),
    publishChatGPTAccountAction: () => undefined,
    suggestChatGPTConversationTitle: async () => 'title',
    hideChatGPTSidebar: async () => ({ ok: true }),
    ...options,
  })
  return { registered, calls }
}

test('account lifecycle IPC queues durable worker tasks without creating a Supervisor', async () => {
  const { registered, calls } = handlers({
    ensureChatGPTView: () => { throw new Error('must not create a Supervisor') },
  })
  const request = { cacheKey: 'chat-1' }
  for (const [channel, type] of [
    ['queue-archive', 'ARCHIVE_CHAT'],
    ['queue-rename', 'RENAME_CHAT'],
    ['queue-delete', 'DELETE_CHAT'],
  ]) {
    assert.deepEqual(await registered.get(`wharness:chatgpt:${channel}`)({}, request), { ok: true })
    assert.deepEqual(calls.at(-1), [type, request])
  }
})

test('stop and title actions require the owned ChatGPT entry', async () => {
  let stopCalls = 0
  const { registered } = handlers({
    requireOwnedChatGPTEntry: () => { throw new Error('foreign owner') },
    stopChatGPTConversation: async () => { stopCalls++; return { stopped: true } },
  })
  await assert.rejects(registered.get('wharness:chatgpt:stop-conversation')({}, { cacheKey: 'chat-1' }), /foreign owner/)
  await assert.rejects(registered.get('wharness:chatgpt:suggest-title')({}, { cacheKey: 'chat-1' }), /foreign owner/)
  assert.equal(stopCalls, 0)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { registerChatGPTPromptIPC } from './prompt.mjs'

function setup() {
  const channels = new Map()
  const calls = []
  const drafts = new Map([['chat-1', { requestId: 'prepared-1' }]])
  registerChatGPTPromptIPC({
    ipcMain: { handle: (channel, handler) => channels.set(channel, handler) },
    trustedSender: () => ({ id: 'owner' }),
    withChatGPTSupervisorTransport: async (key, owner, requestId, operation) => {
      calls.push(['supervisor', key, owner.id, requestId])
      return operation(key, { id: 'captured-entry' })
    },
    submitPromptToChatGPT: async () => ({ ok: true }),
    queuePreparedPromptForWorker: async () => ({ queued: true }),
    preparePromptForChatGPT: async (_request, entry) => ({ entry: entry.id }),
    retryPreparedChatGPTPrompt: async (_request, entry) => ({ entry: entry.id }),
    attachContextToChatGPT: async () => ({ ok: true }),
    attachPromptToChatGPT: async () => ({ ok: true }),
    sanitizeChatCacheKey: (key) => key,
    preparedChatGPTDrafts: drafts,
    submitPreparedChatGPTDraft: async () => ({ ok: true }),
    queueChatGPTComment: async () => ({ queued: true }),
    cancelChatGPTRequestState: async () => ({ cancelled: true }),
  })
  return { channels, calls }
}

test('background preparation goes to the Worker while foreground requests retain their Supervisor entry', async () => {
  const { channels, calls } = setup()
  const prepare = channels.get('wharness:chatgpt:prepare-prompt')
  assert.deepEqual(await prepare({}, { cacheKey: 'chat-1', requestId: 'req-1', background: true }), { queued: true })
  assert.equal(calls.length, 0)
  assert.deepEqual(await prepare({}, { cacheKey: 'chat-1', requestId: 'req-1' }), { entry: 'captured-entry' })
  assert.deepEqual(calls.at(-1), ['supervisor', 'chat-1', 'owner', 'req-1'])
  await channels.get('wharness:chatgpt:submit-prepared')({}, { cacheKey: 'chat-1' })
  assert.deepEqual(calls.at(-1), ['supervisor', 'chat-1', 'owner', 'prepared-1'])
})

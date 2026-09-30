import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceChatRemote } from './workspace-remote.mjs'

function fixture(ok = true) {
  const calls = []
  const remote = createWorkspaceChatRemote({
    sanitizeChatCacheKey: (value) => String(value || '').trim(),
    canonicalChatGPTConversationURL: (value) => String(value || ''),
    BACKEND_URL: 'http://127.0.0.1:8888',
    fetch: async (url, request) => {
      calls.push({ url: String(url), request })
      return { ok, status: ok ? 200 : 503, json: async () => ({ ok: true }) }
    },
  })
  return { remote, calls }
}

test('durable chat identity rejects auxiliary and Orchestrator surfaces', () => {
  const { remote } = fixture()
  assert.equal(remote.durableWorkspaceChatID('chat-1'), 'chat-1')
  assert.equal(remote.durableWorkspaceChatID('chat-1', 'other'), '')
  assert.equal(remote.durableWorkspaceChatID('chat_cf_1'), '')
  assert.equal(remote.durableWorkspaceChatID('otk_1'), '')
})

test('remote state update addresses only the canonical workspace chat', async () => {
  const { remote, calls } = fixture()
  await remote.persistWorkspaceChatRemote('chat-1', 'https://chatgpt.com/c/1', { remoteState: 'awaiting-response' })
  assert.equal(calls[0].url, 'http://127.0.0.1:8888/api/workspace-chats/chat-1/remote')
  assert.equal(calls[0].request.method, 'PATCH')
  assert.equal(JSON.parse(calls[0].request.body).remote_state, 'awaiting-response')
})

test('best effort persistence reports backend failure without blocking local work', async () => {
  const { remote } = fixture(false)
  assert.deepEqual(
    await remote.persistWorkspaceChatRemoteBestEffort('chat-1', 'https://chatgpt.com/c/1'),
    { ok: false, error: 'workspace chat remote state HTTP 503' },
  )
})

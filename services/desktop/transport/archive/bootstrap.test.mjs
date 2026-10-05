import test from 'node:test'
import assert from 'node:assert/strict'
import { chatInputArchiveFilename, localChatInputBootstrap } from './index.mjs'

test('local bootstrap points the model at the prompt inside the single archive', () => {
  const requestId = 'req_20260905T083123_example123'
  const archive = chatInputArchiveFilename('chat-1', requestId)
  const bootstrap = localChatInputBootstrap(requestId, archive, `whx_bundle_res_chat-1_${requestId}.zip`)
  assert.match(bootstrap, new RegExp(archive.replaceAll('.', '\\.')))
  assert.match(bootstrap, /prompt\/wharness-planner-prompt\.md/)
  assert.match(bootstrap, new RegExp(`whx_bundle_res_chat-1_${requestId}\\.zip`))
  assert.doesNotMatch(bootstrap, /Return the bundle|USER REQUEST|PROJECT MANIFEST/)
  assert.equal(bootstrap.split('\n').length, 2)
})

test('local bootstrap carries no tunnel endpoint (adr/ADR-0074)', () => {
  const requestId = 'req_20260905T083123_example123'
  const archive = chatInputArchiveFilename('chat-1', requestId)
  const bootstrap = localChatInputBootstrap(requestId, archive, `whx_bundle_res_chat-1_${requestId}.zip`, { chat_title: 'Title' })
  assert.doesNotMatch(bootstrap, /TUNNEL|https?:\/\//)
})

test('local bootstrap exposes the same engine-owned request metadata as the archive', () => {
  const requestId = 'req_20260905T083123_example123'
  const archive = chatInputArchiveFilename('chat-1', requestId)
  const bootstrap = localChatInputBootstrap(requestId, archive, `whx_bundle_res_chat-1_${requestId}.zip`, {
    chat_title: 'Temporary title', chat_id: 'chat-1', chat_hash: 'b'.repeat(64), requested_at: '2026-09-15T23:04:43Z',
  })
  assert.match(bootstrap, /WHARNEX REQUEST METADATA/)
  assert.match(bootstrap, /ChatTitle: Temporary title/)
  assert.match(bootstrap, /ChatId: chat-1/)
  assert.match(bootstrap, new RegExp(`ChatHash: ${'b'.repeat(64)}`))
  assert.match(bootstrap, /RequestedAt: 2026-09-15T23:04:43.000Z/)
})

test('input archive filename rejects non-canonical request ids', () => {
  assert.throws(() => chatInputArchiveFilename('chat-1', 'request-1'), /Invalid Wharnex request id/)
})

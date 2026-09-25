import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseRemoteInputResponse, remoteInputPayload } from './remote-input.mjs'
import { remoteInputPublicationSignal } from './remote-input-timeout.mjs'

test('remote input payload translates bounded Desktop attachments and project references to the backend wire shape', () => {
  assert.deepEqual(remoteInputPayload('req_1', 'full prompt', 'short user request', true, [{ name: 'note.txt', mime: 'text/plain', contentBase64: 'bm90ZQ==' }], [], ['src/App.tsx'], ['primary'], { chat_title: 'Title' }), {
	request_id: 'req_1', prompt: 'full prompt', bootstrap_text: 'short user request', include_context: true,
    attachments: [{ name: 'note.txt', mime: 'text/plain', content_base64: 'bm90ZQ==' }], artifacts: [], project_files: ['src/App.tsx'], tunnel_instance_ids: ['primary'],
    request_metadata: { chat_title: 'Title' },
  })
})

test('remote input response falls back only when storage is explicitly disabled', () => {
  assert.equal(parseRemoteInputResponse(409, { error: { code: 'remote_storage_disabled' } }), null)
  assert.throws(() => parseRemoteInputResponse(503, { error: { message: 'provider unavailable' } }), /provider unavailable/)
  assert.equal(parseRemoteInputResponse(201, { mode: 'tunnel', provider: 'trycloudflare', bootstrap_prompt: 'download it' })?.bootstrapPrompt, 'download it')
	assert.equal(parseRemoteInputResponse(201, { mode: 'remote_channel', provider: 'trycloudflare', bootstrap_prompt: 'read manifest' })?.bootstrapPrompt, 'read manifest')
	assert.throws(() => parseRemoteInputResponse(201, { mode: 'tunnel', bootstrap_prompt: 'x'.repeat(16 * 1024 + 1) }), /invalid remote input bootstrap/)
})

test('remote publication has its own bounded deadline while preserving user cancellation', async () => {
  const bounded = remoteInputPublicationSignal(undefined, 5)
  await new Promise((resolve) => bounded.signal.addEventListener('abort', resolve, { once: true }))
  assert.equal(bounded.timedOut(), true)
  bounded.dispose()

  const user = new AbortController()
  const cancelled = remoteInputPublicationSignal(user.signal, 100)
  const aborted = new Promise((resolve) => cancelled.signal.addEventListener('abort', resolve, { once: true }))
  user.abort()
  await aborted
  assert.equal(cancelled.timedOut(), false)
  cancelled.dispose()
})

test('prompt preparation bounds optional remote routes before materializing the required ZIP', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function publishRemoteChatInput(')
  const publication = source.slice(start, source.indexOf('\nfunction normalizeTunnelInstanceIDs', start))
  assert.match(publication, /remoteInputPublicationSignal\(signal, REMOTE_INPUT_PUBLICATION_TIMEOUT_MS\)/)
  assert.match(publication, /signal: deadline\.signal/)
  assert.match(publication, /deadline\.dispose\(\)/)
})

test('remote comment mirroring cannot hold a submitted ChatGPT comment indefinitely', async () => {
  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('async function publishRemoteChannelComment(')
  const publication = source.slice(start, source.indexOf('\nasync function pollChatGPTVisibleActivity', start))
  assert.match(publication, /remoteInputPublicationSignal\(undefined, REMOTE_COMMENT_PUBLICATION_TIMEOUT_MS\)/)
  assert.match(publication, /signal: deadline\.signal/)
  assert.match(publication, /deadline\.dispose\(\)/)
})

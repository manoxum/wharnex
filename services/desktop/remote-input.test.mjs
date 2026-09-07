import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRemoteInputResponse, remoteInputPayload } from './remote-input.mjs'

test('remote input payload translates bounded Desktop attachments and project references to the backend wire shape', () => {
  assert.deepEqual(remoteInputPayload('req_1', 'full prompt', 'short user request', true, [{ name: 'note.txt', mime: 'text/plain', contentBase64: 'bm90ZQ==' }], [], ['src/App.tsx'], ['primary']), {
	request_id: 'req_1', prompt: 'full prompt', bootstrap_text: 'short user request', include_context: true,
    attachments: [{ name: 'note.txt', mime: 'text/plain', content_base64: 'bm90ZQ==' }], artifacts: [], project_files: ['src/App.tsx'], tunnel_instance_ids: ['primary'],
  })
})

test('remote input response falls back only when storage is explicitly disabled', () => {
  assert.equal(parseRemoteInputResponse(409, { error: { code: 'remote_storage_disabled' } }), null)
  assert.throws(() => parseRemoteInputResponse(503, { error: { message: 'provider unavailable' } }), /provider unavailable/)
  assert.equal(parseRemoteInputResponse(201, { mode: 'tunnel', provider: 'trycloudflare', bootstrap_prompt: 'download it' })?.bootstrapPrompt, 'download it')
	assert.equal(parseRemoteInputResponse(201, { mode: 'remote_channel', provider: 'trycloudflare', bootstrap_prompt: 'read manifest' })?.bootstrapPrompt, 'read manifest')
	assert.throws(() => parseRemoteInputResponse(201, { mode: 'tunnel', bootstrap_prompt: 'x'.repeat(16 * 1024 + 1) }), /invalid remote input bootstrap/)
})

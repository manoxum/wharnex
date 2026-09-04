import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRemoteInputResponse, remoteInputPayload } from './remote-input.mjs'

test('remote input payload translates bounded Desktop attachments to the backend wire shape', () => {
  assert.deepEqual(remoteInputPayload('req_1', 'full prompt', true, [{ name: 'note.txt', mime: 'text/plain', contentBase64: 'bm90ZQ==' }]), {
    request_id: 'req_1', prompt: 'full prompt', include_context: true,
    attachments: [{ name: 'note.txt', mime: 'text/plain', content_base64: 'bm90ZQ==' }], artifacts: [],
  })
})

test('remote input response falls back only when storage is explicitly disabled', () => {
  assert.equal(parseRemoteInputResponse(409, { error: { code: 'remote_storage_disabled' } }), null)
  assert.throws(() => parseRemoteInputResponse(503, { error: { message: 'provider unavailable' } }), /provider unavailable/)
  assert.equal(parseRemoteInputResponse(201, { mode: 'remote_url', provider: 'rclone', bootstrap_prompt: 'download it' })?.bootstrapPrompt, 'download it')
})

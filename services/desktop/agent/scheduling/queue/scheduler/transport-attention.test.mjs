import test from 'node:test'
import assert from 'node:assert/strict'
import { settleTaskError } from './settlement.mjs'
import { pasteWithUploadRetry } from '../../../../chatgpt/transport/uploads/chatgpt-upload.mjs'

test('a structural transport failure after upload pauses the write instead of selecting the ZIP six times', async () => {
  const transitions = []
  const api = { transition: async (_id, action, body) => transitions.push({ action, body }) }
  const error = Object.assign(new Error('ChatGPT reasoning effort is unavailable (effort-level-unknown)'), { retryTransport: false })
  const result = await settleTaskError(api, { task_id: 'write', attempt: 1, max_attempts: 6 }, 'supervisor-1', error)
  assert.equal(result.status, 'attention')
  assert.equal(transitions.length, 1)
  assert.equal(transitions[0].action, 'attention')
})

test('an ambiguous upload retains its no-replay disposition through the upload wrapper and scheduler', async () => {
  const uncertain = Object.assign(new Error('file upload failed: net::ERR_FAILED'), { retryFileSelection: false })
  let selections = 0
  let observedError
  await assert.rejects(pasteWithUploadRetry({
    beginUpload: () => Promise.reject(uncertain),
    paste: async () => { selections += 1 },
    wait: async () => {},
  }), (error) => { observedError = error; return /state is uncertain/.test(error.message) })
  const actions = []
  const result = await settleTaskError({ transition: async (_id, action) => actions.push(action) },
    { task_id: 'write', attempt: 1, max_attempts: 6 }, 'supervisor-1', observedError)
  assert.equal(selections, 1)
  assert.equal(observedError.retryFileSelection, false)
  assert.equal(result.status, 'attention')
  assert.deepEqual(actions, ['attention'])
})

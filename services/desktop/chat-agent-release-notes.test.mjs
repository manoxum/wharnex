import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseNotesResultFilename, validateReleaseNotesWorkerPayload } from './chat-agent-release-notes.mjs'

const taskID = 'cat_0123456789abcdef0123'

function payload(patch = {}) {
  return {
    protocol: 'wharness.release-notes-input/v1',
    task: 'generate_release_notes',
    task_id: taskID,
    branch: 'origin/main',
    request_filename: `whx_release_notes_req_${taskID}.zip`,
    result_filename: `whx_release_notes_res_${taskID}.zip`,
    bootstrap: 'WHARNEX INPUT cat_0123456789abcdef0123',
    archive_base64: Buffer.from('zip-bytes').toString('base64'),
    reasoning_effort: 'instant',
    ...patch,
  }
}

test('release notes worker binds the expected result bundle to the task id', () => {
  assert.equal(releaseNotesResultFilename(taskID), `whx_release_notes_res_${taskID}.zip`)
  assert.equal(validateReleaseNotesWorkerPayload(taskID, payload()).filename, `whx_release_notes_res_${taskID}.zip`)
  assert.throws(() => validateReleaseNotesWorkerPayload(taskID, payload({ result_filename: 'whx_release_notes_res_cat_aaaaaaaaaaaaaaaaaaaa.zip' })), /foreign result artifact/)
})

test('release notes worker rejects the retired free-form prompt transport', () => {
  assert.throws(() => validateReleaseNotesWorkerPayload(taskID, {
    protocol: 'wharness.release-notes-input/v1', task: 'generate_release_notes', task_id: taskID,
    prompt: 'Write release notes as prose.',
  }), /foreign result artifact|request archive|composer bootstrap/)
})

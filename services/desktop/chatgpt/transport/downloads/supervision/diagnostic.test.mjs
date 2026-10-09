import test from 'node:test'
import assert from 'node:assert/strict'
import { createDownloadDiagnosticRecorder } from './diagnostic.mjs'

test('download diagnostic recording is bounded, correlated and rate limited without suppressing a changed reason', () => {
  const lines = []
  const record = createDownloadDiagnosticRecorder((line) => lines.push(line))
  const expected = { requestId: 'req_owned', filename: 'whx_bundle_res_owned_req.zip' }
  record('chat_owned', expected, { state: 'no-candidates', prose: 'secret answer' }, 'observed', 100_000)
  record('chat_owned', expected, { state: 'no-candidates', prose: 'secret answer' }, 'observed', 100_001)
  assert.equal(lines.length, 1)
  record('chat_owned', expected, { state: 'no-candidates' }, 'observed', 130_000)
  record('chat_owned', expected, undefined, 'ownership', 130_001)
  assert.equal(lines.length, 3)
  assert.match(lines[0], /key=chat_owned request=req_owned/)
  assert.doesNotMatch(lines.join('\n'), /secret answer|prose/)
})

test('a failed operational logger cannot fail or change transport observation', () => {
  const record = createDownloadDiagnosticRecorder(() => { throw new Error('logger unavailable') })
  assert.doesNotThrow(() => record('chat', { requestId: 'req', filename: 'file.zip' }, { state: 'ready', mode: 'exact' }))
})

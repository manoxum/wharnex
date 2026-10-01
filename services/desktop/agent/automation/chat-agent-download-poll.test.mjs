import assert from 'node:assert/strict'
import test from 'node:test'
import { pollWorkerExpectedDownload, WORKER_DOWNLOAD_RETRY_MS } from './chat-agent-download-poll.mjs'

test('Worker probes the exact completed artifact even when its assistant baseline has not advanced', async () => {
  const expected = { filename: 'whx_bundle_res_orchestrator_orp_20260927T144117_72c4527aecd5dbb0.zip', assistantBaseline: 1 }
  const scripts = []
  const execute = async (script) => { scripts.push(script); return 'exact' }
  const script = (filename, baseline) => `${filename}:${baseline}`
  assert.equal(await pollWorkerExpectedDownload(expected, execute, script, 100_000), 'exact')
  assert.deepEqual(scripts, [`${expected.filename}:1`])
  assert.equal(await pollWorkerExpectedDownload(expected, execute, script, 101_000), '')
  assert.equal(await pollWorkerExpectedDownload(expected, execute, script, 100_000 + WORKER_DOWNLOAD_RETRY_MS), 'exact')
  expected.downloadStarted = true
  assert.equal(await pollWorkerExpectedDownload(expected, execute, script, 150_000), '')
  assert.equal(scripts.length, 2)
})

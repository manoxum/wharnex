import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { bundleUploadMetadata, observeBundleDownload } from './index.mjs'

const task = 'cat_11111111111111111111'
const filename = `whx_ui_test_guide_res_${task}.zip`

test('records each completed owned download once, including semantically rejected bundles', () => {
  const item = Object.assign(new EventEmitter(), { getReceivedBytes: () => 120 })
  const lines = []
  observeBundleDownload(item, filename.replace('.zip', ' (2).zip'), (line) => lines.push(line))
  observeBundleDownload(item, filename, (line) => lines.push(line))
  item.emit('done', {}, 'completed')
  assert.deepEqual(lines, [`[chatgpt-bundle-received] completed file=${filename} bytes=120 task=${task}`])
})

test('cancelled, interrupted, oversized and unrelated downloads do not count', () => {
  for (const [name, state, bytes] of [[filename, 'cancelled', 12], [filename, 'interrupted', 12], [filename, 'completed', 17 * 1024 * 1024], ['private-data.zip', 'completed', 12]]) {
    const item = Object.assign(new EventEmitter(), { getReceivedBytes: () => bytes })
    observeBundleDownload(item, name, () => assert.fail('unexpected transport record'))
    item.emit('done', {}, state)
  }
})

test('upload metadata contains only the canonical basename and owned task id', () => {
  assert.equal(bundleUploadMetadata(`/private/tmp/whx_ui_test_step_req_${task}_2.zip`), ` name=whx_ui_test_step_req_${task}_2.zip task=${task}`)
  assert.equal(bundleUploadMetadata('/private/API_KEY=secret.zip'), '')
  assert.equal(bundleUploadMetadata('/private/other.zip'), '')
})

test('broken logging cannot interrupt a download', () => {
  const item = Object.assign(new EventEmitter(), { getReceivedBytes: () => 12 })
  observeBundleDownload(item, filename, () => { throw new Error('logger unavailable') })
  assert.doesNotThrow(() => item.emit('done', {}, 'completed'))
})

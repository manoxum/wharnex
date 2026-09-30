import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLegacyPlanDownload } from './legacy-plan.mjs'

function download(humanBrowsing, errors) {
  return createLegacyPlanDownload({
    tempPath: () => '/tmp', maxBytes: 2 * 1024 * 1024,
    requestIdFromFilename: () => '', validatePlanFile: () => {},
    publishPlan: () => {}, publishError: (...args) => errors.push(args),
    humanBrowsing, sanitizeURL: () => 'https://chatgpt.com/',
  })
}

test('unknown automation downloads fail closed while human browser downloads remain ordinary', () => {
  const errors = []
  let cancelled = 0
  const item = { cancel: () => { cancelled += 1 }, getMimeType: () => 'application/octet-stream' }
  const source = { getURL: () => 'https://chatgpt.com/' }
  download(() => false, errors)(item, 'unexpected.bin', source, 'chat-1')
  assert.equal(cancelled, 1)
  assert.deepEqual(errors, [])
  download(() => true, errors)(item, 'manual.bin', source, 'chat-1')
  assert.equal(cancelled, 1)
})

test('malformed legacy plan names are rejected even from a human browsing surface', () => {
  const errors = []
  let cancelled = false
  download(() => true, errors)({ cancel: () => { cancelled = true } }, 'wharness-plan-invalid.txt', undefined, 'chat-1')
  assert.equal(cancelled, true)
  assert.deepEqual(errors, [[
    'Nome do ficheiro de plano inválido; esperado wharness-plan-<request_id>.json.',
    'wharness-plan-invalid.txt', 'chat-1',
  ]])
})

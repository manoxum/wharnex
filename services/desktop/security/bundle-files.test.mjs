import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalWharnexBundleDownload, validateWharnessBundleDownload, validateWharnessPlanFile, wharnessBundleRequestIdFromFilename, wharnessPlanRequestIdFromFilename } from './security.mjs'

test('Wharnex plan filenames are strict and expose the request id', () => {
  assert.equal(wharnessPlanRequestIdFromFilename('wharness-plan-req_20260902T222529_d18d51d84abc677c.json'), 'req_20260902T222529_d18d51d84abc677c')
  assert.equal(wharnessPlanRequestIdFromFilename('plan.json'), '')
  assert.equal(wharnessPlanRequestIdFromFilename('wharness-plan-../../evil.json'), '')
})

test('downloaded plan JSON must match filename request id and protocol', () => {
  const filename = 'wharness-plan-req_20260902T222529_d18d51d84abc677c.json'
  const valid = JSON.stringify({ protocol: 'harness.execution/v1', request_id: 'req_20260902T222529_d18d51d84abc677c' })
  assert.equal(validateWharnessPlanFile(filename, valid).requestId, 'req_20260902T222529_d18d51d84abc677c')
  assert.throws(() => validateWharnessPlanFile(filename, '{bad json'))
  assert.throws(() => validateWharnessPlanFile(filename, JSON.stringify({ protocol: 'other', request_id: 'req_20260902T222529_d18d51d84abc677c' })))
  assert.throws(() => validateWharnessPlanFile(filename, JSON.stringify({ protocol: 'harness.execution/v1', request_id: 'req_other_12345678' })))
})

test('Wharnex execution bundle filenames are strict and ZIP bytes are checked', () => {
  const name = 'whx_bundle_res_chat_req_20260903T005500_abcdef1234567890.zip'
  assert.equal(wharnessBundleRequestIdFromFilename(name), 'req_20260903T005500_abcdef1234567890')
  assert.equal(validateWharnessBundleDownload(name, Uint8Array.from([0x50, 0x4b, 0x03, 0x04])).requestId, 'req_20260903T005500_abcdef1234567890')
  assert.throws(() => validateWharnessBundleDownload(name, Uint8Array.from([1, 2, 3, 4])))
  assert.equal(wharnessBundleRequestIdFromFilename('bundle.zip'), '')
})

test('generic ChatGPT ZIP names normalize only against the active expected request', () => {
  const requestId = 'req_20260903T112307_7f79e5fe040d3e2d'
  assert.deepEqual(canonicalWharnexBundleDownload('Baixar o bundle Wharnex.zip', requestId, 'application/zip'), {
    requestId,
    filename: `whx_bundle_res_chat_${requestId}.zip`,
    normalized: true,
    sourceFilename: 'Baixar o bundle Wharnex.zip',
  })
  assert.equal(canonicalWharnexBundleDownload('notes.pdf', requestId, 'application/pdf'), undefined)
  assert.throws(() => canonicalWharnexBundleDownload('whx_bundle_res_chat_req_20260903T112307_a1a1a1a1a1a1a1a1.zip', requestId, 'application/zip'), /pedido ativo/)
  assert.throws(() => canonicalWharnexBundleDownload('wharness-bundle-wrong.zip', requestId, 'application/zip'), /não pode ser normalizado/)
})

test('Chromium duplicate suffix normalizes only when the embedded bundle request is active', () => {
  const requestId = 'req_20260905T225921_c0e570d71b7c6819'
  for (const sourceFilename of [
    `whx_bundle_res_chat_${requestId}(1).zip`,
    `whx_bundle_res_chat_${requestId} (2).zip`,
  ]) {
    assert.deepEqual(canonicalWharnexBundleDownload(sourceFilename, requestId, 'application/zip'), {
      requestId,
      filename: `whx_bundle_res_chat_${requestId}.zip`,
      normalized: true,
      sourceFilename,
    })
  }
  assert.throws(
    () => canonicalWharnexBundleDownload('whx_bundle_res_chat_req_20260905T225921_b2b2b2b2b2b2b2b2(1).zip', requestId, 'application/zip'),
    /pedido ativo/,
  )
})

test('a strict canonical bundle name accepts a legacy cache key containing underscores', () => {
  // Upgrade compatibility: old queued tasks may still carry a synthetic key,
  // whose underscores are sanitized in the canonical filename.
  const requestId = 'req_20260907T150015_22475c9e3adb3473'
  const chatId = '7f91c76e-029e-4d2d-b8bc-ca6bc8f8c85e'
  const cacheKey = `${chatId}_cf_conflict_20260907T150015_22475c9e3adb3473`
  const sanitized = `${chatId}-cf-conflict-20260907T150015-22475c9e3adb3473`
  const filename = `whx_bundle_res_${sanitized}_${requestId}.zip`
  assert.deepEqual(canonicalWharnexBundleDownload(filename, requestId, 'application/zip', cacheKey), {
    requestId,
    filename,
    normalized: false,
  })
  assert.throws(
    () => canonicalWharnexBundleDownload(filename, requestId, 'application/zip', `${cacheKey}-different`),
    /chat ativo/,
  )
})

test('the backend-provided canonical filename is authoritative for generic and strict downloads', () => {
  const rootRequest = 'req_20260907T150015_22475c9e3adb3473'
  const requestId = 'req_20260907T151122_32475c9e3adb3474'
  const expected = `whx_bundle_res_chat-owner_${rootRequest}_${requestId}.zip`
  assert.deepEqual(canonicalWharnexBundleDownload('download.zip', requestId, 'application/zip', 'local_cache_key', expected), {
    requestId,
    filename: expected,
    normalized: true,
    sourceFilename: 'download.zip',
  })
  assert.deepEqual(canonicalWharnexBundleDownload(expected, requestId, 'application/zip', 'local_cache_key', expected), {
    requestId,
    filename: expected,
    normalized: false,
  })
  assert.throws(
    () => canonicalWharnexBundleDownload(`whx_bundle_res_other_${rootRequest}_${requestId}.zip`, requestId, 'application/zip', 'local_cache_key', expected),
    /pedido ativo pertence|protocolo exige/,
  )
})

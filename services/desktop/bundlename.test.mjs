import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBundleName, parseBundleName, requestIdFromBundleName, safeChatId, CHAT_ID_PATTERN } from './bundlename.mjs'

const chatId = '9f3a2b1c-uuid-like'
const rootReq = 'req_20260906T192238_1adfea24039ba474'
const derivedId = 'req_20260906T193501_a512a09f68dd0c96'

test('builds and parses a main-request bundle name', () => {
  const name = buildBundleName('req', chatId, rootReq)
  assert.equal(name, `whx_bundle_req_${chatId}_${rootReq}.zip`)
  const parsed = parseBundleName(name)
  assert.deepEqual(parsed, { kind: 'req', chatId, requestId: rootReq, subrequestId: '' })
  assert.equal(requestIdFromBundleName(name), rootReq)
})

test('builds and parses a derived-request bundle name', () => {
  const name = buildBundleName('res', chatId, rootReq, derivedId)
  assert.equal(name, `whx_bundle_res_${chatId}_${rootReq}_${derivedId}.zip`)
  const parsed = parseBundleName(name)
  assert.deepEqual(parsed, { kind: 'res', chatId, requestId: rootReq, subrequestId: derivedId })
  assert.equal(requestIdFromBundleName(name), derivedId)
})

test('collapses a subrequest id equal to the request id back to main-request form', () => {
  assert.equal(buildBundleName('req', chatId, rootReq, rootReq), buildBundleName('req', chatId, rootReq))
})

test('rejects names outside the scheme', () => {
  for (const bad of [
    'wharness-bundle-req_20260906T192238_1adfea24039ba474.zip',
    'wharness-input-req_20260906T192238_1adfea24039ba474.zip',
    `whx_bundle_bad_${chatId}_${rootReq}.zip`,
    `whx_bundle_req_${chatId}_not-a-request-id.zip`,
    '',
  ]) {
    assert.equal(parseBundleName(bad), null, bad)
  }
})

test('chat id pattern rejects the scheme separator', () => {
  assert.equal(CHAT_ID_PATTERN.test('chat_with_underscore'), false)
  assert.equal(CHAT_ID_PATTERN.test('f47ac10b-58cc-4372-a567-0e02b2c3d479'), true)
})

test('safeChatId sanitizes a compound conflict cache key instead of rejecting it', () => {
  assert.equal(safeChatId('f47ac10b-58cc-4372-a567-0e02b2c3d479'), 'f47ac10b-58cc-4372-a567-0e02b2c3d479')
  assert.equal(safeChatId('chat-1:conflict_abc'), 'chat-1-conflict-abc')
  assert.equal(safeChatId(''), 'chat')
})

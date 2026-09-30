import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTBundleExpectation } from './state.mjs'

test('rearming a request preserves progress while a new request resets it', () => {
  const expectedChatGPTBundles = new Map()
  let time = 100
  const expectation = createChatGPTBundleExpectation({
    buildBundleName: (_, chat, id) => `whx_bundle_res_${chat}_${id}.zip`,
    safeChatId: (value) => value,
    requestIdFromFilename: (filename) => filename.match(/_(req-[^.]+)\.zip$/)?.[1] || '',
    parseBundleName: (filename) => ({ kind: 'res', requestId: filename.match(/_(req-[^.]+)\.zip$/)?.[1] || '' }),
    sanitizeChatCacheKey: (key) => key,
    expectedChatGPTBundles,
    createChatGPTRecoveryState: (at) => ({ at }),
    now: () => time,
  })

  const filename = expectation.armExpectedChatGPTBundle('chat', 'req-one', 2, 'bootstrap', ['a'], 'prompt', 'session', '', { round: 1 })
  assert.equal(filename, 'whx_bundle_res_chat_req-one.zip')
  const first = expectedChatGPTBundles.get('chat')
  first.continuationCount = 2
  first.progressAt = 110
  first.mainRequestTaskId = 'task'
  time = 200
  expectation.armExpectedChatGPTBundle('chat', 'req-one', 1)
  const rearmed = expectedChatGPTBundles.get('chat')
  assert.equal(rearmed.armedAt, 100)
  assert.equal(rearmed.assistantBaseline, 2)
  assert.equal(rearmed.continuationCount, 2)
  assert.equal(rearmed.progressAt, 110)
  assert.equal(rearmed.mainRequestTaskId, 'task')
  assert.deepEqual(rearmed.requestMetadata, { round: 1 })
  assert.deepEqual(rearmed.liveTunnels, ['a'])
  expectation.disarmExpectedChatGPTBundle('chat', 'req-other')
  assert.equal(expectedChatGPTBundles.has('chat'), true)

  expectation.armExpectedChatGPTBundle('chat', 'req-two', 0)
  const fresh = expectedChatGPTBundles.get('chat')
  assert.equal(fresh.armedAt, 200)
  assert.equal(fresh.continuationCount, 0)
  assert.equal(fresh.mainRequestTaskId, '')
  assert.deepEqual(fresh.liveTunnels, [])
  expectation.disarmExpectedChatGPTBundle('chat', 'req-two')
  assert.equal(expectedChatGPTBundles.has('chat'), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createExpectedBundleLookup } from './lookup.mjs'

test('exact bundle request id routes across views before local or recent hints', () => {
  const expected = new Map([
    ['chat-a', { requestId: 'req-a', armedAt: 100 }],
    ['chat-b', { requestId: 'req-b', armedAt: 100 }],
  ])
  const lookup = createExpectedBundleLookup({
    expectedChatGPTBundles: expected,
    chatgptViews: new Map([['chat-a', { view: { webContents: { id: 1 } } }]]),
    requestIdFromFilename: (name) => name.match(/(req-[ab])\.zip$/)?.[1] || '',
    sanitizeOptionalChatCacheKey: (key) => key,
    recentDownload: () => ({ key: 'chat-a', requestId: 'req-a', at: 150 }),
    ttlMs: 1000, now: () => 200,
  })
  assert.deepEqual(lookup.expectedChatGPTBundleForDownload({ id: 1 }, 'req-b.zip'), { key: 'chat-b', ...expected.get('chat-b') })
  assert.deepEqual(lookup.expectedChatGPTBundleForDownload({ id: 1 }, 'other.zip'), { key: 'chat-a', ...expected.get('chat-a') })
  assert.equal(lookup.chatGPTExpectedKeyForRequest('req-b', 'chat-a'), 'chat-b')
})

test('expired source and stale recent hint do not claim a download', () => {
  const lookup = createExpectedBundleLookup({
    expectedChatGPTBundles: new Map([['chat', { requestId: 'req', armedAt: 0 }]]),
    chatgptViews: new Map([['chat', { view: { webContents: { id: 1 } } }]]),
    requestIdFromFilename: () => '', sanitizeOptionalChatCacheKey: (key) => key,
    recentDownload: () => ({ key: 'chat', requestId: 'req', at: 0 }),
    ttlMs: 1000, now: () => 20_000,
  })
  assert.equal(lookup.expectedChatGPTBundleForDownload({ id: 1 }, 'other.zip'), undefined)
})

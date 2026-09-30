import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTDownloadPublication } from './publication.mjs'

function publicationHarness() {
  const sent = []
  const delivered = []
  const handlers = createChatGPTDownloadPublication({
    sendToChatGPTKey: (...args) => sent.push(args),
    sanitizeChatCacheKey: (key) => key,
    parseBundleName: () => null,
    path: { basename: (name) => name.split('/').at(-1) },
    deliverOrchestratorTaskBundle: (...args) => delivered.push(args),
    wharnessBundleRequestIdFromFilename: (name) => name === 'late.zip' ? 'old-request' : '',
    expectedChatGPTBundles: new Map([['chat-1', { requestId: 'new-request' }]]),
  })
  return { ...handlers, sent, delivered }
}

test('bundle publication separates window routing from durable chat ownership', () => {
  const { publishBundleDownload, sent } = publicationHarness()
  const payload = { cacheKey: '', filename: 'whx_bundle_res_other_req.zip' }
  publishBundleDownload(payload, 'visible-chat')
  assert.deepEqual(sent[0], ['visible-chat', 'wharness:chatgpt:bundle-downloaded', payload])
  assert.equal(payload.cacheKey, '')
})

test('orchestrator bundles bypass the renderer and late errors keep their filename request ID', () => {
  const { publishBundleDownload, publishBundleDownloadError, sent, delivered } = publicationHarness()
  const taskID = 'otk_20260929T123456_0123456789abcdef'
  const payload = { cacheKey: taskID, filename: 'task.zip' }
  publishBundleDownload(payload)
  assert.deepEqual(delivered, [[taskID, payload]])
  assert.equal(sent.length, 0)
  publishBundleDownloadError('failure', 'late.zip', 'chat-1')
  assert.equal(sent[0][2].requestId, 'old-request')
})

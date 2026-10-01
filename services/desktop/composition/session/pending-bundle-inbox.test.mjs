import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPendingBundleInbox } from './index.mjs'

test('replays only valid undelivered bundles and acknowledges them once', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'wharnex-inbox-'))
  const deliveries = new Map()
  const delivered = new Set()
  const cancelled = []
  const enqueued = []
  const inbox = createPendingBundleInbox({
    app: { getPath: () => userData }, path, readdir, readFile, rm,
    requestIdFromFilename: (name) => name === 'response.zip' ? 'request-1' : '',
    recentlyDelivered: (id) => delivered.has(id),
    validateBundle: (_name, bytes) => { assert.equal(bytes.toString(), 'valid') },
    deliveries, sanitizeChatCacheKey: (key) => key,
    markDelivered: (id) => delivered.add(id),
    cancelRequest: async (...args) => { cancelled.push(args) },
    scheduler: () => ({}), parseBundleName: () => ({ kind: 'res', chatId: 'chat-1' }),
    safeChatId: (key) => key, enqueueTask: async (...args) => { enqueued.push(args) },
    retentionMs: 1000,
  })
  try {
    await mkdir(inbox.pendingBundleDirectory())
    await writeFile(path.join(inbox.pendingBundleDirectory(), 'response.zip'), 'valid')
    await writeFile(path.join(inbox.pendingBundleDirectory(), 'other.zip'), 'invalid')
    assert.deepEqual(await inbox.pendingChatGPTBundlePayloads(), [{
      cacheKey: '', filename: 'response.zip', requestId: 'request-1',
      contentBase64: Buffer.from('valid').toString('base64'), bytes: 5, recovered: true,
    }])
    await assert.rejects(inbox.acknowledgeChatGPTBundle('chat-1', 'request-1', 'wrong.zip'), /filename mismatch/)
    assert.deepEqual(await inbox.acknowledgeChatGPTBundle('chat-1', 'request-1', 'response.zip'), {
      ok: true, requestId: 'request-1', alreadyAcknowledged: false,
    })
    assert.deepEqual(cancelled, [['chat-1', 'request-1']])
    assert.equal(enqueued[0][0], 'DELETE_BUNDLE')
    assert.deepEqual(await inbox.pendingChatGPTBundlePayloads(), [])
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createChatGPTBundleDownload } from './bundle.mjs'

function item() {
  const handlers = new Map()
  return {
    handlers, savePath: '', cancelled: false,
    getTotalBytes: () => 3, getReceivedBytes: () => 3,
    setSavePath(value) { this.savePath = value },
    cancel() { this.cancelled = true },
    on(name, handler) { handlers.set(name, handler) },
    once(name, handler) { handlers.set(name, handler) },
  }
}

test('validated bundle stays in the durable inbox until acknowledgement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharnex-bundle-'))
  const pending = new Map()
  const live = { requestId: 'req-1', downloadInFlight: true }
  const events = []
  const published = []
  const handle = createChatGPTBundleDownload({
    pendingDeliveries: pending, maxBytes: 16 * 1024 * 1024,
    pendingDirectory: () => root, expectedBundles: new Map([['chat-1', live]]),
    validateBundle: (filename, bytes) => { assert.equal(filename, 'answer.zip'); assert.equal(bytes.toString(), 'zip'); return { requestId: 'req-1' } },
    recordValidBundle: () => {}, recentlyDelivered: () => false,
    quiesceRecovery: (...args) => events.push(['quiesce', ...args]),
    publishBundle: (...args) => published.push(args), publishError: (message) => { throw new Error(message) },
    recordTaskEvent: (...args) => events.push(args), sanitizeURL: (value) => value,
  })
  const download = item()
  try {
    handle(download, 'answer.zip', { getURL: () => 'https://chatgpt.com/c/one' }, { key: 'chat-1', requestId: 'req-1' }, 'chat-1', { filename: 'answer.zip', requestId: 'req-1' })
    await writeFile(download.savePath, 'zip')
    await download.handlers.get('done')(undefined, 'completed')
    assert.equal(live.downloadInFlight, false)
    assert.equal(pending.get('req-1').cacheKey, 'chat-1')
    assert.equal((await readFile(download.savePath)).toString(), 'zip')
    assert.equal(published[0][0].contentBase64, 'emlw')
    assert.equal(events[0][0], 'quiesce')
    assert.equal(events[1][1], 'chatgpt.bundle_validated')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('invalid bundle clears the in-flight guard, records rejection and removes bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wharnex-bundle-'))
  const live = { requestId: 'req-1', downloadInFlight: true }
  const events = []
  const errors = []
  const handle = createChatGPTBundleDownload({
    pendingDeliveries: new Map(), maxBytes: 16 * 1024 * 1024,
    pendingDirectory: () => root, expectedBundles: new Map([['chat-1', live]]),
    validateBundle: () => { throw new Error('invalid protocol') },
    recordValidBundle: () => {}, recentlyDelivered: () => false,
    quiesceRecovery: () => {}, publishBundle: () => {},
    publishError: (...args) => errors.push(args),
    recordTaskEvent: (...args) => events.push(args), sanitizeURL: (value) => value,
  })
  const download = item()
  try {
    handle(download, 'answer.zip', undefined, { key: 'chat-1', requestId: 'req-1' }, 'chat-1', { filename: 'answer.zip', requestId: 'req-1' })
    await writeFile(download.savePath, 'bad')
    await download.handlers.get('done')(undefined, 'completed')
    assert.equal(live.downloadInFlight, false)
    assert.equal(live.invalidBundleCount, 1)
    assert.equal(events[0][1], 'chatgpt.bundle_rejected')
    assert.equal(errors[0][0], 'invalid protocol')
    await assert.rejects(readFile(download.savePath), { code: 'ENOENT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

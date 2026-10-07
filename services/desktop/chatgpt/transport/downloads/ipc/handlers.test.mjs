import test from 'node:test'
import assert from 'node:assert/strict'
import { registerChatGPTBundleIPC } from './index.mjs'

function registered(options = {}) {
  const channels = new Map()
  const deliveries = new Map()
  registerChatGPTBundleIPC({
    ipcMain: { handle: (name, handler) => channels.set(name, handler) },
    trustedSender: () => ({ window: {} }),
    sanitizeChatCacheKey: (key) => key,
    canonicalBundleFilename: () => 'whx_bundle_req-1.zip',
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/whx_bundle_req-1.zip'] }) },
    app: { getPath: () => '/tmp' },
    path: { basename: (value) => value.split('/').at(-1) },
    readFile: async () => Buffer.from('bundle'),
    MAX_EXECUTION_BUNDLE_BYTES: 1024,
    canonicalWharnexBundleDownload: (filename) => ({ filename, normalized: true }),
    validateWharnessBundleDownload: () => ({ requestId: 'req-1' }),
    pendingChatGPTBundlePayloads: () => [{ filename: 'pending.zip' }],
    acknowledgeChatGPTBundle: (...args) => args,
    pendingChatGPTBundleDeliveries: deliveries,
    ...options,
  })
  return { channels, deliveries }
}

test('picker accepts only a bounded validated ZIP for the selected request', async () => {
  const { channels } = registered()
  const pick = channels.get('wharness:chatgpt:pick-bundle')
  const result = await pick({}, { cacheKey: 'chat-1', requestId: 'req-1' })
  assert.equal(result.requestId, 'req-1')
  assert.equal(result.sourceFilename, 'whx_bundle_req-1.zip')
  assert.equal(result.contentBase64, Buffer.from('bundle').toString('base64'))

  const oversized = registered({ readFile: async () => Buffer.alloc(1025) }).channels.get('wharness:chatgpt:pick-bundle')
  await assert.rejects(oversized({}, { requestId: 'req-1' }), /16 MiB/)
  const mismatched = registered({ validateWharnessBundleDownload: () => ({ requestId: 'other' }) }).channels.get('wharness:chatgpt:pick-bundle')
  await assert.rejects(mismatched({}, { requestId: 'req-1' }), /pedido ativo/)
})

test('delivery IPC retains a failed bundle and routes acknowledgments to its request', async () => {
  const { channels, deliveries } = registered()
  deliveries.set('req-1', { cacheKey: '' })
  assert.deepEqual(await channels.get('wharness:chatgpt:pending-bundles')({}), [{ filename: 'pending.zip' }])
  assert.deepEqual(await channels.get('wharness:chatgpt:ack-bundle')({}, {
    cacheKey: 'chat-1', requestId: 'req-1', filename: 'bundle.zip',
  }), ['chat-1', 'req-1', 'bundle.zip'])
  assert.deepEqual(await channels.get('wharness:chatgpt:nack-bundle')({}, {
    cacheKey: 'chat-1', requestId: 'req-1',
  }), { ok: true, requestId: 'req-1', retained: true })
  assert.equal(deliveries.get('req-1').cacheKey, 'chat-1')
})

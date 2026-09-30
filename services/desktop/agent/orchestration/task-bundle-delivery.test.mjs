import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createOrchestratorBundleDelivery } from './task-bundle-delivery.mjs'

test('task bundle delivery waits for ingestion and acknowledges only after success', async () => {
  const calls = []
  const delivery = createOrchestratorBundleDelivery({
    backendURL: 'http://127.0.0.1:8888',
    pendingDeliveries: new Map(),
    acknowledge: async (...args) => { calls.push(['ack', ...args]) },
    scheduler: () => ({ list: async () => ({ tasks: [] }) }),
    enqueue: async () => { throw new Error('unexpected repair') },
    canonicalURL: () => '',
    postLongRunning: async (...args) => { calls.push(['post', ...args]) },
  })
  await delivery.deliverOrchestratorTaskBundle('otk_20260929T202134_1234567890abcdef', {
    cacheKey: 'otk_20260929T202134_1234567890abcdef',
    requestId: 'req_123', filename: 'answer.zip', contentBase64: 'YQ==',
  })
  assert.deepEqual(calls, [
    ['post', 'http://127.0.0.1:8888', '/api/orchestrator/tasks/otk_20260929T202134_1234567890abcdef/bundle', { filename: 'answer.zip', content_base64: 'YQ==' }],
    ['ack', 'otk_20260929T202134_1234567890abcdef', 'req_123', 'answer.zip'],
  ])
})

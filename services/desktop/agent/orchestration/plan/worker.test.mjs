import assert from 'node:assert/strict'
import test from 'node:test'
import { createOrchestratorPlanWorker } from './index.mjs'

function fixture(overrides = {}) {
  return {
    sanitizeSessionId: (id) => id,
    orchestratorDeliveryFor: (name) => name.endsWith('.json') ? 'json' : 'bundle',
    orchestratorBundleFilename: (id) => id + '.zip',
    orchestratorPlanFilename: (id) => id + '.json',
    canonicalChatGPTConversationURL: (url) => url,
    ...overrides,
  }
}

const task = {
  task_id: 'cat_12345678901234567890',
  session_id: 'session-1',
  request_id: 'orp_12345678',
}
const payload = { protocol: 'harness.orchestrator-planning/v1', prompt: 'Plan this' }

test('orchestrator plan worker rejects malformed protocol and foreign checkpoint filenames', async () => {
  const worker = createOrchestratorPlanWorker(fixture({
    takeRetainedChatGPTOrchestratorPlan: () => assert.fail('invalid payload must not claim artifacts'),
  }))
  assert.deepEqual(await worker(task, {}, 'key', { ...payload, protocol: 'foreign' }, 'owner'), {
    status: 'failed', error: 'invalid orchestrator planning worker protocol payload',
  })
  assert.deepEqual(await worker(task, {}, 'key', { ...payload, expected_filename: 'other.zip' }, 'owner'), {
    status: 'failed', error: 'orchestrator planning checkpoint filename does not match its task',
  })
})

test('a retained plan completes before touching a provider surface', async () => {
  const calls = []
  const worker = createOrchestratorPlanWorker(fixture({
    takeRetainedChatGPTOrchestratorPlan: async (filename) => {
      calls.push(['claim', filename])
      return Buffer.from('retained')
    },
    importRetainedOrchestratorPlan: async (_sessionId, requestId, delivery) => {
      calls.push(['import', requestId, delivery])
      return { status: 'done', payload: { requestId } }
    },
    removeStoredChatAttachments: async () => calls.push(['remove-attachments']),
    chatAttachmentRoot: () => '/private/attachments',
    tempPath: () => assert.fail('retained plan must not create a request directory'),
  }))
  const result = await worker(task, {}, 'key', { ...payload, attachment_cache_key: 'attachments' }, 'owner')
  assert.deepEqual(result, { status: 'done', payload: { requestId: 'orp_12345678' } })
  assert.deepEqual(calls, [
    ['claim', 'orp_12345678.zip'],
    ['import', 'orp_12345678', 'bundle'],
    ['remove-attachments'],
  ])
})

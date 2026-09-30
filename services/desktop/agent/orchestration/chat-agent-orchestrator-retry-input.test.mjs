import assert from 'node:assert/strict'
import { test } from 'node:test'
import { orchestratorRetryInput } from './chat-agent-orchestrator-retry-input.mjs'

test('reads only attachments bound to the failed task retry context', async () => {
  const task = { retry_context: {
    attachment_cache_key: 'retry_1', project_files: ['src/main.ts'],
    attachments: [{ name: 'evidence.txt', size: 4, storage_ref: 'retry_1/message/0' }],
  } }
  const calls = []
  const input = await orchestratorRetryInput(task, async (ref) => {
    calls.push(ref)
    return { name: 'evidence.txt', mime: 'text/plain', contentBase64: Buffer.from('note').toString('base64') }
  })
  assert.deepEqual(calls, ['retry_1/message/0'])
  assert.deepEqual(input.projectFiles, ['src/main.ts'])
  assert.equal(input.attachments[0].name, 'evidence.txt')
})

test('rejects a foreign or changed retry attachment', async () => {
  const retry_context = { attachment_cache_key: 'retry_1', attachments: [{ name: 'evidence.txt', size: 4, storage_ref: 'other/message/0' }] }
  await assert.rejects(orchestratorRetryInput({ retry_context }, async () => ({})), /another context/)
  retry_context.attachments[0].storage_ref = 'retry_1/message/0'
  await assert.rejects(orchestratorRetryInput({ retry_context }, async () => ({ name: 'evidence.txt', contentBase64: Buffer.from('bad').toString('base64') })), /changed/)
})

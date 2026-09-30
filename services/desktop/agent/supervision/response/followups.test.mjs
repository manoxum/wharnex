import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatAgentFollowups } from './followups.mjs'

test('response followup persists request lineage and the exact expected filename', async () => {
  let queued
  const followups = createChatAgentFollowups({
    canonicalChatGPTConversationURL: (url) => url,
    authoritativeBundleFilename: (_name, requestId, key) => `bundle:${key}:${requestId}`,
    chatAgentInitialRequestWaitMs: () => 1000,
    enqueueChatAgentTask: async (type, task) => { queued = { type, task }; return { task_id: 'await-1' } },
  })
  const result = await followups.enqueueChatAgentFollowups('chat-1', 'req-1', 'https://chatgpt.com/c/owned', {
    sessionId: 'ses-1', projectPath: '/project', requestEligibleAt: '2026-09-30T12:00:00.000Z',
    liveTunnels: Array.from({ length: 20 }, (_, index) => index),
  })
  assert.deepEqual(result, { task_id: 'await-1' })
  assert.equal(queued.type, 'AWAIT_RESPONSE')
  assert.equal(queued.task.dedupeKey, 'await:req-1')
  assert.equal(queued.task.rootRequestId, 'req-1')
  assert.equal(queued.task.projectID, '/project')
  assert.equal(queued.task.payload.expected_filename, 'bundle:chat-1:req-1')
  assert.equal(queued.task.payload.live_tunnels.length, 16)
  assert.equal(queued.task.notBefore, '2026-09-30T12:00:00.000Z')
})

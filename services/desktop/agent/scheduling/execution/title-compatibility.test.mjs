import assert from 'node:assert/strict'
import test from 'node:test'
import { createLegacyTitleTasks } from './title-compatibility.mjs'

test('legacy title tasks only clean up an exact temporary conversation once', async () => {
  const queued = []
  const tasks = createLegacyTitleTasks({
    canonicalChatGPTConversationURL: (url) => url === 'https://chatgpt.com/c/temp' ? url : '',
    chatAgentChildExists: async () => false,
    enqueueChatAgentTask: async (...args) => { queued.push(args) },
    chatAgentConversationID: () => 'temp',
  })
  assert.deepEqual(await tasks.executeChatAgentTitleDiscover(), { status: 'done' })
  assert.deepEqual(await tasks.executeChatAgentTempTitle(), { status: 'done' })
  assert.deepEqual(await tasks.executeChatAgentTitleAwait(
    { task_id: 'task-1', request_id: 'req-1' }, null, 'chat-1', { temp_url: 'https://chatgpt.com/c/temp' },
  ), { status: 'done' })
  assert.equal(queued.length, 1)
  assert.equal(queued[0][0], 'DELETE_TEMP_CHAT')
  assert.equal(queued[0][1].dedupeKey, 'delete-temp:temp')
  assert.equal(queued[0][1].parentTaskID, 'task-1')
})

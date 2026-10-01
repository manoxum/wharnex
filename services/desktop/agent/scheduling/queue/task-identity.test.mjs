import assert from 'node:assert/strict'
import test from 'node:test'
import { chatAgentTaskPayload, createChatAgentConversationURL } from './task-identity.mjs'

test('task identity rejects malformed payloads and unsafe conversation ids', () => {
  const chatAgentConversationURL = createChatAgentConversationURL(
    (value) => value === 'https://chatgpt.com/c/exact' ? value : '',
  )
  assert.deepEqual(chatAgentTaskPayload({ payload: '{broken' }), {})
  assert.equal(chatAgentConversationURL({ conversation_id: 'owned-123' }), 'https://chatgpt.com/c/owned-123')
  assert.equal(chatAgentConversationURL({ conversation_id: '../unsafe' }), '')
  assert.equal(chatAgentConversationURL({ payload: { conversation_url: 'https://chatgpt.com/c/exact' } }), 'https://chatgpt.com/c/exact')
})

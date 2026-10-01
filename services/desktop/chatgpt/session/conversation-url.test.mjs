import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatGPTConversationURLs } from './conversation-url.mjs'

const urls = createChatGPTConversationURLs((value) => {
  const url = new URL(value)
  if (url.origin !== 'https://chatgpt.com') throw new Error('untrusted origin')
  return url.href
})

test('project conversation URLs resolve to the same durable conversation', () => {
  const projectURL = 'https://chatgpt.com/g/g-p-project/c/conversation-123'
  assert.equal(urls.conversationID(projectURL), 'conversation-123')
  assert.equal(urls.canonicalURL(projectURL), 'https://chatgpt.com/c/conversation-123')
  assert.equal(urls.sameConversation(projectURL, 'https://chatgpt.com/c/conversation-123'), true)
})

test('provisional, malformed and untrusted URLs cannot bind a conversation', () => {
  for (const value of ['WEB:new', 'local-chatgpt:new', 'https://other.example/c/one', 'https://chatgpt.com/c/bad%20id']) {
    assert.equal(urls.conversationID(value), '')
    assert.equal(urls.canonicalURL(value), '')
    assert.equal(urls.sameConversation(value, 'https://chatgpt.com/c/one'), false)
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTConversationSettlement } from './index.mjs'

test('submitted conversation waits for a stable URL and records its affinity once', async () => {
  const originalNow = Date.now
  let now = 1_000
  Date.now = () => now
  const settled = []
  const wc = { isDestroyed: () => false, isLoading: () => false, getURL: () => 'https://chatgpt.com/c/owned' }
  try {
    const { waitForSubmittedChatGPTConversation } = createChatGPTConversationSettlement({
      canonicalChatGPTConversationURL: (value) => value.startsWith('https://chatgpt.com/c/') ? value : '',
      requireOwnedChatGPTEntry: () => ({ wc }),
      settleChatGPTAffinityAfterSubmit: (...args) => settled.push(args),
      wait: async (ms) => { now += ms },
    })
    const value = await waitForSubmittedChatGPTConversation('key', { view: wc }, 'https://chatgpt.com/c/fallback')
    assert.equal(value, 'https://chatgpt.com/c/owned')
    assert.deepEqual(settled, [['key', { view: wc }, value]])
  } finally {
    Date.now = originalNow
  }
})

test('missing concrete conversation returns a canonical fallback without binding', async () => {
  const settled = []
  const wc = { isDestroyed: () => true }
  const { waitForSubmittedChatGPTConversation } = createChatGPTConversationSettlement({
    canonicalChatGPTConversationURL: (value) => value.startsWith('https://chatgpt.com/c/') ? value : '',
    requireOwnedChatGPTEntry: () => ({ wc }),
    settleChatGPTAffinityAfterSubmit: (...args) => settled.push(args),
    wait: async () => {},
  })
  const value = await waitForSubmittedChatGPTConversation('key', {}, 'https://chatgpt.com/c/fallback')
  assert.equal(value, 'https://chatgpt.com/c/fallback')
  assert.deepEqual(settled, [])
})

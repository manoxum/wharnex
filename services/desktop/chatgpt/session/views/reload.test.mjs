import test from 'node:test'
import assert from 'node:assert/strict'
import { createOwnedChatGPTConversationReload } from './reload.mjs'

function fixture(url, boundURL) {
  const events = []
  const wc = { getURL: () => url, reload: () => events.push('reload') }
  const entry = { affinity: { boundURL } }
  const { reloadOwnedChatGPTConversation } = createOwnedChatGPTConversationReload({
    sanitizeChatCacheKey: (key) => key,
    requireOwnedChatGPTEntry: () => ({ wc }),
    canonicalChatGPTConversationURL: (value) => value.startsWith('https://chatgpt.com/c/') ? value : '',
    sameConversationURL: (a, b) => a === b,
    loadOwnedChatGPTURL: async (_, __, target, reason) => events.push([target, reason]),
    isTrustedChatGPTOrigin: (value) => value.startsWith('https://chatgpt.com/'),
    homeURL: 'https://chatgpt.com/',
  })
  return { reloadOwnedChatGPTConversation, events, entry }
}

test('reload restores the bound conversation before refreshing a different page', async () => {
  const { reloadOwnedChatGPTConversation, events, entry } = fixture('https://chatgpt.com/c/other', 'https://chatgpt.com/c/owned')
  assert.deepEqual(await reloadOwnedChatGPTConversation('chat', entry, 'manual'), {
    restoredLinkedConversation: true, conversationUrl: 'https://chatgpt.com/c/owned',
  })
  assert.deepEqual(events, [['https://chatgpt.com/c/owned', 'manual-linked']])
})

test('trusted bound page reloads in place; untrusted page falls back to home', async () => {
  const trusted = fixture('https://chatgpt.com/c/owned', 'https://chatgpt.com/c/owned')
  assert.deepEqual(await trusted.reloadOwnedChatGPTConversation('chat', trusted.entry), {
    restoredLinkedConversation: false, conversationUrl: 'https://chatgpt.com/c/owned',
  })
  assert.deepEqual(trusted.events, ['reload'])

  const untrusted = fixture('https://example.invalid/', '')
  assert.deepEqual(await untrusted.reloadOwnedChatGPTConversation('chat', untrusted.entry), {
    restoredLinkedConversation: false, conversationUrl: '',
  })
  assert.deepEqual(untrusted.events, [['https://chatgpt.com/', 'reload-fallback']])
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTAffinityRuntime } from './affinity-runtime.mjs'

test('submission settlement proposes an unbound conversation and publishes its candidate', () => {
  const events = []
  const affinity = { boundURL: '', phase: 'unbound' }
  const entry = { affinity, view: { webContents: { getURL: () => 'https://chatgpt.com/' } } }
  const runtime = createChatGPTAffinityRuntime({
    requireTrustedChatGPTURL: (value) => value,
    observeChatGPTAffinity: (_affinity, value) => value.conversationUrl,
    canonicalChatGPTConversationURL: (value) => String(value).includes('/c/') ? value : '',
    syncChatGPTAffinity: () => {}, homeURL: 'https://chatgpt.com/',
    sanitizeDiagnosticURL: (value) => value,
    proposeChatGPTAffinity: (_affinity, candidate) => { events.push(['propose', candidate]); return candidate },
    publishChatGPTState: (key) => events.push(['publish', key]),
    settleChatGPTAffinity: () => '', isChatGPTAffinityAwaitingSettlement: () => false,
    chatGPTKeyForEntry: () => 'chat', waitForConcreteChatGPTConversation: async () => '',
  })
  const url = 'https://chatgpt.com/c/one'
  assert.equal(runtime.settleChatGPTAffinityAfterSubmit('chat', entry, url), url)
  assert.deepEqual(events, [['propose', url], ['publish', 'chat']])
  assert.equal(runtime.isChatGPTNewChatSurfaceURL('https://chatgpt.com/'), true)
  assert.equal(runtime.isChatGPTNewChatSurfaceURL(url), false)
})

test('late affinity settlement ignores a view rebound to another chat', async () => {
  let settled = 0
  const entry = { affinity: {}, view: { webContents: { getURL: () => 'https://chatgpt.com/c/one' } } }
  const runtime = createChatGPTAffinityRuntime({
    requireTrustedChatGPTURL: (value) => value, observeChatGPTAffinity: () => '',
    canonicalChatGPTConversationURL: (value) => value,
    syncChatGPTAffinity: () => {}, homeURL: 'https://chatgpt.com/',
    sanitizeDiagnosticURL: (value) => value, proposeChatGPTAffinity: () => '',
    publishChatGPTState: () => {}, settleChatGPTAffinity: () => { settled += 1 },
    isChatGPTAffinityAwaitingSettlement: () => true,
    chatGPTKeyForEntry: () => 'other',
    waitForConcreteChatGPTConversation: async () => 'https://chatgpt.com/c/one',
  })
  runtime.scheduleChatGPTAffinitySettlement('chat', entry)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(settled, 0)
  assert.equal(entry.affinitySettleTimer, undefined)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreparedPromptRetry } from './prepared.mjs'

const request = { cacheKey: 'chat-1', sessionId: 'ses-1', expectedRequestId: 'req-1' }

test('retry restores a cancelled durable write as an unsubmitted draft', async () => {
  let restored
  let persistedCalls = 0
  const payload = { cacheKey: 'chat-1', sessionId: 'ses-1', requestId: 'req-1', text: 'Original request', autoSubmit: true }
  const retry = createPreparedPromptRetry({
    sanitizeChatCacheKey: (value) => value,
    expectedChatGPTBundles: new Map(),
    recentlyDeliveredChatGPTBundleRequestId: () => false,
    retryableChatGPTPrompts: new Map(), RETRYABLE_PROMPT_TTL_MS: 1000,
    getChatAgentScheduler: () => ({ list: async () => ({ tasks: [{
      type: 'BOT_WRITE', status: 'CANCELLED', chat_id: 'chat-1', request_id: 'req-1',
      session_id: 'ses-1', payload: { operation: 'PREPARE_PROMPT', request: payload },
    }] }) }),
    preparePromptForChatGPT: async (value) => { restored = value; return { submitted: false } },
    retryPersistedChatGPTPrompt: async () => { persistedCalls += 1 },
  })

  const result = await retry.retryPreparedChatGPTPrompt(request)
  assert.equal(result.submitted, false)
  assert.equal(restored.text, 'Original request')
  assert.equal(restored.autoSubmit, false)
  assert.equal(restored.background, false)
  assert.equal(persistedCalls, 0)
})

test('retry refuses a durable write belonging to a different session', async () => {
  let prepared = false
  let persisted = false
  const retry = createPreparedPromptRetry({
    sanitizeChatCacheKey: (value) => value,
    expectedChatGPTBundles: new Map(),
    recentlyDeliveredChatGPTBundleRequestId: () => false,
    retryableChatGPTPrompts: new Map(), RETRYABLE_PROMPT_TTL_MS: 1000,
    getChatAgentScheduler: () => ({ list: async () => ({ tasks: [{
      type: 'BOT_WRITE', status: 'CANCELLED', chat_id: 'chat-1', request_id: 'req-1',
      session_id: 'ses-other', payload: { operation: 'PREPARE_PROMPT', request: { ...request, requestId: 'req-1' } },
    }] }) }),
    preparePromptForChatGPT: async () => { prepared = true },
    retryPersistedChatGPTPrompt: async () => { persisted = true },
  })

  await retry.retryPreparedChatGPTPrompt(request)
  assert.equal(prepared, false)
  assert.equal(persisted, true)
})

test('retry does not restore a cancelled draft while another write is active', async () => {
  let prepared = false
  const payload = { cacheKey: 'chat-1', sessionId: 'ses-1', requestId: 'req-1', text: 'Original request' }
  const retry = createPreparedPromptRetry({
    sanitizeChatCacheKey: (value) => value,
    expectedChatGPTBundles: new Map(),
    recentlyDeliveredChatGPTBundleRequestId: () => false,
    retryableChatGPTPrompts: new Map(), RETRYABLE_PROMPT_TTL_MS: 1000,
    getChatAgentScheduler: () => ({ list: async () => ({ tasks: [
      { type: 'BOT_WRITE', status: 'CANCELLED', chat_id: 'chat-1', request_id: 'req-1', session_id: 'ses-1', payload: { operation: 'PREPARE_PROMPT', request: payload } },
      { type: 'BOT_WRITE', status: 'PENDING', chat_id: 'chat-1', request_id: 'req-1', session_id: 'ses-1' },
    ] }) }),
    preparePromptForChatGPT: async () => { prepared = true },
  })

  await assert.rejects(retry.retryPreparedChatGPTPrompt(request), /envio em curso ou concluído/)
  assert.equal(prepared, false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createValidatedBundleState } from './validated.mjs'

test('validated bundle quiesces preparation and durable recovery before publication', async () => {
  const events = []
  const expected = { requestId: 'req', downloadInFlight: true }
  const delivered = new Map()
  const state = createValidatedBundleState({
    deliveredChatGPTBundleRequestIds: delivered, dedupTtlMs: 100,
    pendingChatGPTBundleDeliveries: new Map(),
    expectedChatGPTBundles: new Map([['chat', expected]]),
    chatGPTExpectedKeyForRequest: () => 'chat',
    abortChatGPTTransportPreparations: () => events.push('abort'),
    scheduler: () => ({ cancelLineage: async () => { events.push('cancel'); return {} } }),
    refreshChatAgentRuntimeState: async () => events.push('refresh'),
    publishChatAgentRuntimeState: () => events.push('publish'),
    now: () => 50,
  })
  state.quiesceChatGPTRecoveryAfterValidatedBundle('req')
  assert.equal(expected.bundleCollectedAt, 50)
  assert.equal(expected.downloadInFlight, false)
  assert.deepEqual(events.slice(0, 2), ['abort', 'cancel'])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['abort', 'cancel', 'refresh', 'publish'])
  state.markChatGPTBundleRequestDelivered('req')
  assert.equal(state.recentlyDeliveredChatGPTBundleRequestId('req'), true)
  assert.equal(state.chatGPTBundleAlreadyValidated('req'), true)
  assert.equal(state.chatGPTBundleAlreadyValidated(''), false)
})

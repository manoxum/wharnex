import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTRequestCancellation } from './cancel.mjs'

test('cancellation clears only matching request state and cancels durable lineage', async () => {
  const events = []
  const expectedChatGPTBundles = new Map([['chat', { requestId: 'old' }]])
  const retryableChatGPTPrompts = new Map([['chat', { request: { requestId: 'new' } }]])
  const preparedChatGPTDrafts = new Map([['chat', { requestId: 'old' }]])
  const pendingChatGPTComments = new Map([['chat', [{ requestId: 'old' }, { requestId: 'new' }]]])
  const entry = { humanAction: { active: true, requestId: 'old' } }
  const { cancelChatGPTRequestState } = createChatGPTRequestCancellation({
    sanitizeChatCacheKey: (key) => key,
    abortChatGPTTransportPreparations: (key, id) => { events.push(`abort:${key}:${id}`); return 1 },
    expectedChatGPTBundles, retryableChatGPTPrompts, preparedChatGPTDrafts,
    manualChatGPTTransport: { clear: async () => false }, pendingChatGPTComments,
    chatgptViews: new Map([['chat', entry]]),
    clearChatGPTHumanAction: () => events.push('clear-human'),
    reconcileChatGPTThrottle: () => events.push('throttle'),
    scheduler: () => ({ cancelLineage: async (id) => { events.push(`lineage:${id}`); return { cancelled: 2 } } }),
    refreshChatAgentRuntimeState: async () => events.push('refresh'),
    publishChatAgentRuntimeState: () => events.push('publish'),
  })
  assert.deepEqual(await cancelChatGPTRequestState('chat', 'old'), {
    ok: true, cacheKey: 'chat', requestId: 'old', cleared: true,
    cancelledTasks: 2, abortedPreparations: 1,
  })
  assert.equal(expectedChatGPTBundles.has('chat'), false)
  assert.equal(preparedChatGPTDrafts.has('chat'), false)
  assert.equal(retryableChatGPTPrompts.has('chat'), true)
  assert.deepEqual(pendingChatGPTComments.get('chat'), [{ requestId: 'new' }])
  assert.deepEqual(events, ['abort:chat:old', 'clear-human', 'throttle', 'lineage:old', 'refresh', 'publish'])
  await assert.rejects(cancelChatGPTRequestState('chat', ''), /requires a request id/)
})

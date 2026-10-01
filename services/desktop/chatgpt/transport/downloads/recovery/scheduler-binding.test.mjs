import test from 'node:test'
import assert from 'node:assert/strict'
import { registerExpectedBundleRecoveryIPC } from './index.mjs'
import { registerResumeExpectedBundleIPC } from './resume.mjs'
import { classifyChatGPTRequestDelivery } from '../../requests/chatgpt-request-delivery.mjs'

test('recovery IPC resolves the scheduler after startup registration', async () => {
  const handlers = new Map()
  let scheduler
  const request = { cacheKey: 'chat-1', requestId: 'request-1', url: 'https://chatgpt.com/c/one' }
  registerExpectedBundleRecoveryIPC({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    trustedSender: () => ({}),
    sanitizeChatCacheKey: (value) => value,
    requireTrustedChatGPTURL: (value) => value,
    canonicalChatGPTConversationURL: (value) => value,
    authoritativeBundleFilename: () => 'bundle.zip',
    getChatAgentScheduler: () => scheduler,
    classifyChatGPTRequestDelivery: () => 'writing',
    expectedChatGPTBundles: new Map([['chat-1', { requestId: 'request-1' }]]),
  })
  scheduler = { list: async () => ({ tasks: [] }) }

  const resumed = await handlers.get('wharness:chatgpt:resume-expected-bundle')({}, request)
  const continued = await handlers.get('wharness:chatgpt:continue-expected-bundle')({}, request)
  assert.equal(resumed.reason, 'write_in_progress')
  assert.equal(continued.reason, 'write_in_progress')
})

test('resume does not cancel a write queued while DOM evidence is read', async () => {
  const handlers = new Map()
  let reads = 0
  let cancelled = 0
  let disarmed = 0
  registerResumeExpectedBundleIPC({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    trustedSender: () => ({}), sanitizeChatCacheKey: (value) => value,
    requireTrustedChatGPTURL: (value) => value,
    canonicalChatGPTConversationURL: (value) => value,
    authoritativeBundleFilename: () => 'bundle.zip',
    getChatAgentScheduler: () => ({
      list: async () => ({ tasks: ++reads === 1 ? [] : [{ type: 'BOT_WRITE', status: 'PENDING', chat_id: 'chat-1' }] }),
      cancelLineage: async () => { cancelled += 1 },
    }),
    classifyChatGPTRequestDelivery,
    ensureChatGPTView: () => ({ entry: { loading: false } }),
    requireOwnedChatGPTEntry: () => undefined,
    withChatGPTTransportPreparation: (_key, _entry, _id, operation) => operation(),
    targetChatGPTComposer: async () => ({ wc: { isLoading: () => false } }),
    executeChatGPTDOMScript: async () => ({ submitted: false }),
    chatGPTSubmittedRequestEvidenceScript: () => 'probe',
    chatInputArchiveFilename: () => 'input.zip',
    disarmExpectedChatGPTBundle: () => { disarmed += 1 },
  })

  const result = await handlers.get('wharness:chatgpt:resume-expected-bundle')({}, {
    cacheKey: 'chat-1', requestId: 'req-1', url: 'https://chatgpt.com/c/one',
  })
  assert.equal(reads, 2)
  assert.equal(result.reason, 'write_in_progress')
  assert.equal(cancelled, 0)
  assert.equal(disarmed, 0)
})

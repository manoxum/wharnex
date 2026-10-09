import test from 'node:test'
import assert from 'node:assert/strict'
import { createPromptSubmission } from './prompt.mjs'
import { createChatGPTBundleExpectation } from '../../downloads/expectation/state.mjs'

async function submitCorrection(kind) {
  const expectedChatGPTBundles = new Map()
  const expectation = createChatGPTBundleExpectation({
    buildBundleName: () => 'response.zip', safeChatId: (id) => id,
    requestIdFromFilename: () => 'req', parseBundleName: () => ({ kind: 'res', requestId: 'req' }),
    sanitizeChatCacheKey: (id) => id, expectedChatGPTBundles,
    createChatGPTRecoveryState: () => ({}), now: () => 100,
  })
  expectation.armExpectedChatGPTBundle('chat', 'req')
  Object.assign(expectedChatGPTBundles.get('chat'), { armedAt: 1, progressAt: 2,
    continuationCount: 1, automaticContinuationSent: true, rehydrating: true,
    processingObservedAt: 1, processingAbsentSince: 2 })
  const entry = { humanAction: { active: true, kind } }
  const target = { entry, wc: {}, conversationUrl: 'https://chatgpt.com/c/owned' }
  const clears = []
  const { submitPromptToChatGPT } = createPromptSubmission({
    sanitizeChatCacheKey: (id) => id, canonicalBundleFilename: () => 'response.zip',
    targetChatGPTComposer: async () => target, verifyChatGPTDraft: async () => {},
    chatGPTAssistantTurnCount: async () => 2, expectedChatGPTBundles,
    fillBundledChatGPTComposer: async () => ({ bootstrap: 'bootstrap' }),
    wait: async () => {}, submitChatGPTDraft: async () => ({ accepted: true }),
    waitForSubmittedChatGPTConversation: async () => target.conversationUrl,
    armExpectedChatGPTBundle: expectation.armExpectedChatGPTBundle,
    clearChatGPTHumanAction: (...args) => clears.push(args), touchChatGPTEntry: () => {},
  })
  await submitPromptToChatGPT('chat', 'correction', target.conversationUrl, 'req', 'session')
  return { expected: expectedChatGPTBundles.get('chat'), clears }
}

test('accepted correction resumes stale transport attention without resetting request budgets', async () => {
  const { expected, clears } = await submitCorrection('stalled')
  assert.ok(expected.progressAt > 2)
  assert.equal(expected.armedAt, 1)
  assert.equal(expected.continuationCount, 1)
  assert.equal(expected.automaticContinuationSent, true)
  assert.equal(expected.processingObservedAt, 0)
  assert.equal(expected.processingAbsentSince, 0)
  assert.equal(expected.rehydrating, false)
  assert.equal(clears.length, 1)
})

test('a correction never clears a verification gate', async () => {
  const { clears } = await submitCorrection('verification')
  assert.equal(clears.length, 0)
})

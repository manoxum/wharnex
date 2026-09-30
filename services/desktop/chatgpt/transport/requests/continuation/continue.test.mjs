import test from 'node:test'
import assert from 'node:assert/strict'
import { createPromptContinuation } from './continue.mjs'

function continuationHarness(expected, submitChatGPTDraft = async () => ({ accepted: true })) {
  const stages = []
  const target = {
    entry: { transportAbortSignal: undefined },
    wc: {},
    conversationUrl: 'https://chatgpt.com/c/owned',
  }
  const operations = createPromptContinuation({
    sanitizeChatCacheKey: (key) => key,
    chatGPTBundleAlreadyValidated: () => false,
    expectedChatGPTBundles: new Map([['owned', expected]]),
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS: 1,
    canonicalBundleFilename: () => 'response.zip',
    targetChatGPTComposer: async () => target,
    throwIfChatGPTTransportAborted: () => {},
    chatGPTAssistantTurnCount: async () => 3,
    chatGPTDeliveryContinuationPrompt: () => 'continue',
    executeChatGPTDOMScript: async (_key, _entry, stage) => { stages.push(stage); return true },
    chatGPTFillComposerScript: (value) => value,
    wait: async () => {},
    submitChatGPTDraft,
    waitForSubmittedChatGPTConversation: async () => target.conversationUrl,
    touchChatGPTEntry: () => {},
  })
  return { operations, stages, target }
}

test('a continuation already sent for this request skips before targeting ChatGPT', async () => {
  const expected = { requestId: 'req-1', automaticContinuationSent: true }
  const { operations, stages } = continuationHarness(expected)
  const result = await operations.submitChatGPTContinuation('owned', '', 'req-1')
  assert.deepEqual(result, { ok: true, skipped: true, reason: 'wake_already_sent' })
  assert.deepEqual(stages, [])
})

test('a continuation that becomes ineligible after composer fill clears the draft and skips dispatch', async () => {
  const expected = { requestId: 'req-1', automaticContinuationSent: false }
  const { operations, stages } = continuationHarness(expected, async (_key, _entry, _url, _target, { beforeDispatch }) => {
    expected.automaticContinuationSent = true
    await beforeDispatch()
    throw new Error('submission should have been suppressed')
  })
  const result = await operations.submitChatGPTContinuation('owned', '', 'req-1')
  assert.deepEqual(result, { ok: true, skipped: true, reason: 'wake_already_sent' })
  assert.deepEqual(stages, ['fill-keep-continue', 'clear-suppressed-keep-continue'])
})

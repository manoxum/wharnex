import test from 'node:test'
import assert from 'node:assert/strict'
import { createPromptSubmission } from './prompt.mjs'

function fixture(preflightFailure) {
  const events = []
  const target = { entry: {}, wc: {}, conversationUrl: 'https://chatgpt.com/c/owned' }
  const { submitPromptToChatGPT } = createPromptSubmission({
    sanitizeChatCacheKey: (key) => key,
    canonicalBundleFilename: () => 'response.zip',
    targetChatGPTComposer: async () => { events.push('target'); return target },
    verifyChatGPTDraft: async (key, received) => {
      events.push('preflight')
      assert.equal(key, 'owned'); assert.equal(received, target)
      if (preflightFailure) throw preflightFailure
    },
    chatGPTAssistantTurnCount: async () => 1,
    expectedChatGPTBundles: new Map(),
    fillBundledChatGPTComposer: async () => { events.push('upload'); return { bootstrap: 'bootstrap' } },
    wait: async () => {},
    submitChatGPTDraft: async () => { events.push('submit'); return { accepted: true } },
    waitForSubmittedChatGPTConversation: async () => target.conversationUrl,
    armExpectedChatGPTBundle: () => events.push('arm'),
    touchChatGPTEntry: () => {},
  })
  return { submit: () => submitPromptToChatGPT('owned', 'output correction', target.conversationUrl, 'req', 'ses'), events }
}

test('repair verifies model and reasoning effort before selecting its correction archive', async () => {
  const { submit, events } = fixture()
  assert.equal((await submit()).ok, true)
  assert.deepEqual(events, ['target', 'preflight', 'upload', 'submit', 'arm'])
})

test('repair preflight attention propagates without selecting or submitting a file', async () => {
  const error = Object.assign(new Error('effort-level-unknown'), { retryTransport: false })
  const { submit, events } = fixture(error)
  await assert.rejects(submit(), (received) => received === error && received.retryTransport === false)
  assert.deepEqual(events, ['target', 'preflight'])
})

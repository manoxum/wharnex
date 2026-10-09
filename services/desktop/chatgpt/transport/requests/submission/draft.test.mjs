import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTDraftSubmission } from './draft.mjs'

function fixture({ currentURL = 'https://chatgpt.com/c/owned', effortFails = false, cooldown = 0 } = {}) {
  const events = []
  const wc = {
    id: 7, getURL: () => currentURL,
    executeJavaScript: async () => { events.push('click'); return true },
  }
  const entry = { reasoningEffort: 'high', affinity: {} }
  const { submitChatGPTDraft, verifyChatGPTDraft } = createChatGPTDraftSubmission({
    chatAgentWorkerActivity: { set: (phase) => events.push(phase) },
    targetChatGPTComposer: async () => ({ entry, wc }),
    normalizeChatGPTReasoningEffort: (value) => value,
    canonicalChatGPTConversationURL: (value) => value,
    sameConversationURL: (left, right) => left === right,
    ensureChatGPTReasoningEffort: async () => {
      if (effortFails) throw new Error('effort unavailable')
      return { effort: 'high', changed: false, cycles: 0 }
    },
    executeChatGPTDOMScript: async () => ({}),
    reasoningEffortStateScript: () => 'effort-state', CHATGPT_BEHAVIOR: {},
    requireOwnedChatGPTEntry: () => ({ wc }),
    stepChatGPTReasoningEffortToward: async () => {},
    markChatGPTAffinitySubmitted: () => events.push('affinity'),
    submitWithoutReplay: async ({ beforeSubmit, beginObservation, submit }) => {
      await beforeSubmit()
      beginObservation()
      await submit()
      return { accepted: true, requestId: 'req' }
    },
    chatAgentRateLimitDelayMs: () => cooldown,
    ChatGPTRateLimitDeferral: class extends Error {},
    chatGPTSubmissions: { expect: () => events.push('observe') },
    chatGPTSubmitScript: () => 'submit-script',
  })
  return { submitChatGPTDraft, verifyChatGPTDraft, events }
}

test('draft submission verifies conversation before observation and sends once', async () => {
  const { submitChatGPTDraft, events } = fixture()
  assert.deepEqual(await submitChatGPTDraft('chat', undefined, 'https://chatgpt.com/c/owned'), { accepted: true, requestId: 'req' })
  assert.deepEqual(events, ['submitting', 'affinity', 'observe', 'click', 'processing'])

  const moved = fixture({ currentURL: 'https://chatgpt.com/c/other' })
  await assert.rejects(moved.submitChatGPTDraft('chat', undefined, 'https://chatgpt.com/c/owned'), /conversa ChatGPT mudou/)
  assert.deepEqual(moved.events, ['submitting'])
})

test('effort preflight verifies the owned draft without dispatch, affinity mutation or network observation', async () => {
  const { verifyChatGPTDraft, events } = fixture()
  const target = { entry: { reasoningEffort: 'high' }, wc: { getURL: () => 'https://chatgpt.com/c/owned' }, conversationUrl: 'https://chatgpt.com/c/owned' }
  assert.equal((await verifyChatGPTDraft('chat', target)).effort, 'high')
  assert.deepEqual(events, [])
})

test('requested effort and provider cooldown fail before a network observation', async () => {
  const strict = fixture({ effortFails: true })
  await assert.rejects(strict.submitChatGPTDraft('chat'), /effort unavailable/)
  assert.deepEqual(strict.events, ['submitting'])

  const paused = fixture({ cooldown: 100 })
  await assert.rejects(paused.submitChatGPTDraft('chat', undefined, '', undefined, { rateLimitExempt: false }), Error)
  assert.deepEqual(paused.events, ['submitting', 'affinity'])
})

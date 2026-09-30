import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTRecoveryActions } from './index.mjs'

function recoveryHarness(overrides = {}) {
  const calls = []
  const expected = { requestId: 'req-1', filename: 'response.zip', recovery: {} }
  const entry = { affinity: { boundURL: 'https://chatgpt.com/c/owned' } }
  const operations = createChatGPTRecoveryActions({
    requireOwnedChatGPTEntry: () => calls.push('owned'),
    isNetworkRecoveryFault: () => true,
    claimNetworkFaultReloadSlot: () => false,
    commitChatGPTRecoveryAction: () => calls.push('commit'),
    recordChatGPTTaskEvent: () => calls.push('event'),
    reloadOwnedChatGPTConversation: async () => calls.push('reload'),
    sendToChatGPTKey: () => calls.push('activity'),
    setChatGPTHumanAction: () => calls.push('human'),
    chatGPTBundleAlreadyValidated: () => false,
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS: 1,
    withChatGPTTransportPreparation: async () => { calls.push('transport'); return {} },
    expectedChatGPTBundles: new Map([['owned', expected]]),
    submitChatGPTContinuation: async () => { calls.push('submit'); return { ok: true } },
    ...overrides,
  })
  return { operations, calls, expected, entry }
}

test('network reload refuses a full reload slot without committing recovery state', async () => {
  const { operations, calls, expected, entry } = recoveryHarness()
  const result = await operations.performChatGPTRecoveryAction('owned', expected, entry, { type: 'reload', reason: 'transport', detail: 'network' })
  assert.equal(result, false)
  assert.deepEqual(calls, ['owned'])
})

test('a validated response prevents another automatic continuation', async () => {
  const { operations, calls, expected, entry } = recoveryHarness({ chatGPTBundleAlreadyValidated: () => true })
  const result = await operations.performChatGPTRecoveryAction('owned', expected, entry, { type: 'prompt', reason: 'silent' })
  assert.equal(result, true)
  assert.deepEqual(calls, ['owned'])
})

test('continuation preparation errors are bounded before reaching human attention', () => {
  let humanMessage = ''
  const { operations } = recoveryHarness({
    setChatGPTHumanAction: (_key, _kind, message) => { humanMessage = message },
  })
  operations.escalateChatGPTContinuationFailure('owned', { requestId: 'req-1', recovery: {} }, 'x'.repeat(2_000), 'automatic-recovery')
  assert.ok(humanMessage.includes('Não foi possível preparar'))
  assert.ok(humanMessage.length < 600)
})

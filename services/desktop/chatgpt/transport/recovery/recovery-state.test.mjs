import test from 'node:test'
import assert from 'node:assert/strict'
import { chatGPTDeliveryContinuationPrompt, chooseChatGPTRecoveryAction, commitChatGPTRecoveryAction, createChatGPTRecoveryState, noteChatGPTRecoveryFault, noteChatGPTRecoveryProgress } from './index.mjs'

test('delivery continuation is the minimal keep-continue nudge', () => {
  assert.equal(chatGPTDeliveryContinuationPrompt(), 'keep continue')
  assert.equal(chatGPTDeliveryContinuationPrompt('ignored', 'ignored.zip', 'ignored original prompt'), 'keep continue')
})

test('completed response without a validated bundle nudges the same conversation instead of reloading', () => {
  const state = createChatGPTRecoveryState(1_000)
  const action = chooseChatGPTRecoveryAction(state, { complete: true, thinking: false }, 2_000, { actionCooldownMs: 0 })
  assert.equal(action?.type, 'prompt')
  assert.equal(action?.reason, 'completed-without-bundle')
  commitChatGPTRecoveryAction(state, action, 2_000)
  assert.equal(state.completionContinued, true)
  assert.equal(chooseChatGPTRecoveryAction(state, { complete: true }, 9_000, { actionCooldownMs: 0 }), undefined)
})

test('processing that visibly stops before a new assistant turn also gets the short continuation nudge', () => {
  const state = createChatGPTRecoveryState(1_000)
  const action = chooseChatGPTRecoveryAction(state, { processingInterrupted: true, thinking: false, responseStarted: false }, 2_000, { actionCooldownMs: 0 })
  assert.deepEqual(action, {
    type: 'prompt',
    reason: 'processing-interrupted',
    detail: 'visible processing stopped without producing a new assistant turn or validated bundle',
  })
})

test('structural response errors reload once and then require human attention', () => {
  const state = createChatGPTRecoveryState(1_000)
  const first = chooseChatGPTRecoveryAction(state, { failed: true, surfaceReady: true }, 2_000, { actionCooldownMs: 0 })
  assert.equal(first?.reason, 'response-error')
  commitChatGPTRecoveryAction(state, first, 2_000)
  assert.equal(chooseChatGPTRecoveryAction(state, { failed: true, surfaceReady: true }, 10_000, { actionCooldownMs: 0 }), undefined)
  const exhausted = chooseChatGPTRecoveryAction(state, { failed: true, surfaceReady: true }, 18_000, { actionCooldownMs: 0 })
  assert.equal(exhausted?.type, 'human')
})

test('long-running thinking never reloads without an explicit transport fault', () => {
  const state = createChatGPTRecoveryState(1_000)
  noteChatGPTRecoveryProgress(state, 'thinking:first', 2_000)
  assert.equal(chooseChatGPTRecoveryAction(state, { thinking: true }, 10 * 60_000, { actionCooldownMs: 0 }), undefined)
  assert.equal(chooseChatGPTRecoveryAction(state, { thinking: true }, 3 * 60 * 60_000, { actionCooldownMs: 0 }), undefined)
})

test('fault-only or missing liveness snapshots never manufacture a silent recovery', () => {
  const state = createChatGPTRecoveryState(1_000)
  assert.equal(chooseChatGPTRecoveryAction(state, {}, 10 * 60_000, { actionCooldownMs: 0 }), undefined)
  assert.equal(chooseChatGPTRecoveryAction(state, {}, 10 * 60_000, { actionCooldownMs: 0, faultOnly: true }), undefined)
  noteChatGPTRecoveryFault(state, 'renderer unresponsive', 10 * 60_000 + 1)
  assert.equal(chooseChatGPTRecoveryAction(state, {}, 10 * 60_000 + 2, { actionCooldownMs: 0, faultOnly: true })?.reason, 'transport')
})

test('active conversation transport suppresses heuristic silent recovery when the DOM briefly looks idle', () => {
  const state = createChatGPTRecoveryState(1_000)
  const action = chooseChatGPTRecoveryAction(state, {
    complete: false,
    thinking: false,
    responseStarted: false,
    surfaceReady: true,
    transportActive: true,
  }, 10 * 60_000, { silentMs: 30_000, actionCooldownMs: 0 })
  assert.equal(action, undefined)
})

test('silent processing requires human attention and never injects a recovery prompt', () => {
  const state = createChatGPTRecoveryState(1_000)
  const human = chooseChatGPTRecoveryAction(state, { thinking: false, responseStarted: false }, 31_500, { silentMs: 30_000, actionCooldownMs: 0 })
  assert.equal(human?.type, 'human')
  assert.equal(human?.reason, 'silent-ambiguous')
  commitChatGPTRecoveryAction(state, human, 31_500)
  assert.equal(chooseChatGPTRecoveryAction(state, { thinking: false, responseStarted: false }, 60_000, { silentMs: 1, actionCooldownMs: 0 }), undefined)
})

test('initial conversation affinity blocks silent recovery but never masks a concrete transport fault', () => {
  const state = createChatGPTRecoveryState(1_000)
  assert.equal(chooseChatGPTRecoveryAction(state, { awaitingConversationAffinity: true, responseStarted: false }, 40_000, { silentMs: 30_000, actionCooldownMs: 0 }), undefined)
  noteChatGPTRecoveryFault(state, 'net::ERR_CONNECTION_RESET', 41_000)
  const action = chooseChatGPTRecoveryAction(state, { awaitingConversationAffinity: true }, 61_000, { actionCooldownMs: 0 })
  assert.equal(action?.reason, 'transport')
})

test('transport recovery is bounded and escalates to one human intervention instead of looping forever', () => {
  const state = createChatGPTRecoveryState(1_000)
  // Each network-fault reload waits longer than the previous one.
  let at = 2_000
  for (const delay of [20_000, 60_000, 180_000]) {
    noteChatGPTRecoveryFault(state, 'net::ERR_CONNECTION_RESET', at)
    assert.equal(chooseChatGPTRecoveryAction(state, {}, at + delay - 1, { actionCooldownMs: 0, maxTransportReloads: 3 }), undefined)
    const action = chooseChatGPTRecoveryAction(state, {}, at + delay, { actionCooldownMs: 0, maxTransportReloads: 3 })
    assert.equal(action?.reason, 'transport')
    commitChatGPTRecoveryAction(state, action, at + delay)
    at += delay + 1_000
  }
  noteChatGPTRecoveryFault(state, 'net::ERR_CONNECTION_RESET', at)
  const human = chooseChatGPTRecoveryAction(state, {}, at + 180_000, { actionCooldownMs: 0, maxTransportReloads: 3 })
  assert.equal(human?.type, 'human')
  assert.equal(human?.reason, 'transport-exhausted')
  commitChatGPTRecoveryAction(state, human, at + 180_000)
  assert.equal(chooseChatGPTRecoveryAction(state, {}, at + 400_000, { actionCooldownMs: 0, maxTransportReloads: 3 }), undefined)
})

test('missing composer reloads once and escalates when the surface is still unavailable', () => {
  const state = createChatGPTRecoveryState(1_000)
  const reload = chooseChatGPTRecoveryAction(state, { surfaceReady: false, thinking: false, responseStarted: true }, 32_000, { silentMs: 30_000, actionCooldownMs: 0 })
  assert.equal(reload?.reason, 'surface')
  commitChatGPTRecoveryAction(state, reload, 32_000)
  const human = chooseChatGPTRecoveryAction(state, { surfaceReady: false, thinking: false, responseStarted: true }, 48_000, { reloadSettleMs: 15_000, actionCooldownMs: 0 })
  assert.equal(human?.type, 'human')
  assert.equal(human?.reason, 'surface-unavailable')
})

test('an ambiguous post-reload state escalates without an automatic recovery prompt', () => {
  const state = createChatGPTRecoveryState(1_000)
  const reload = { type: 'reload', reason: 'silent' }
  commitChatGPTRecoveryAction(state, reload, 31_500)
  const human = chooseChatGPTRecoveryAction(state, { thinking: false, responseStarted: false }, 47_000, { silentMs: 1, reloadSettleMs: 15_000, actionCooldownMs: 0 })
  assert.equal(human?.type, 'human')
  assert.equal(human?.reason, 'recovery-ambiguous')
})

test('explicit human verification pauses automatic recovery decisions', () => {
  const state = createChatGPTRecoveryState(1_000)
  noteChatGPTRecoveryFault(state, 'net::ERR_CONNECTION_RESET', 2_000)
  assert.equal(chooseChatGPTRecoveryAction(state, { humanActionRequired: true }, 40_000, { actionCooldownMs: 0 }), undefined)
})

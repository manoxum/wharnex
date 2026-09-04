import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chatGPTStalledRecoveryPrompt,
  chooseChatGPTRecoveryAction,
  commitChatGPTRecoveryAction,
  createChatGPTRecoveryState,
  isChatGPTConversationTransportURL,
  isRecoverableChatGPTNetworkError,
  noteChatGPTRecoveryFault,
  noteChatGPTRecoveryProgress,
} from './chatgpt-recovery.mjs'

test('recoverable socket and internet errors request a bounded reload first', () => {
  const state = createChatGPTRecoveryState(1_000)
  noteChatGPTRecoveryFault(state, 'net::ERR_INTERNET_DISCONNECTED', 2_000)
  const action = chooseChatGPTRecoveryAction(state, { thinking: true }, 3_000, { actionCooldownMs: 0 })
  assert.deepEqual(action, { type: 'reload', reason: 'transport', detail: 'net::ERR_INTERNET_DISCONNECTED' })
  commitChatGPTRecoveryAction(state, action, 3_000)
  assert.equal(state.pendingFault, '')
  assert.equal(state.reloadCount, 1)
})

test('completed response without a validated bundle reloads before continuation', () => {
  const state = createChatGPTRecoveryState(1_000)
  const action = chooseChatGPTRecoveryAction(state, { complete: true, thinking: false }, 2_000, { actionCooldownMs: 0 })
  assert.equal(action?.type, 'reload')
  assert.equal(action?.reason, 'completed-without-bundle')
  commitChatGPTRecoveryAction(state, action, 2_000)
  assert.equal(chooseChatGPTRecoveryAction(state, { complete: true }, 9_000, { actionCooldownMs: 0 }), undefined)
})

test('stalled processing reloads once then emits one same-request recovery prompt', () => {
  const state = createChatGPTRecoveryState(1_000)
  noteChatGPTRecoveryProgress(state, 'thinking:first', 2_000)
  const reload = chooseChatGPTRecoveryAction(state, { thinking: true }, 100_000, { stallMs: 90_000, actionCooldownMs: 0 })
  assert.equal(reload?.reason, 'stalled')
  commitChatGPTRecoveryAction(state, reload, 100_000)
  const prompt = chooseChatGPTRecoveryAction(state, { thinking: true }, 116_000, { stallMs: 1, reloadSettleMs: 15_000, actionCooldownMs: 0 })
  assert.equal(prompt?.type, 'prompt')
  commitChatGPTRecoveryAction(state, prompt, 116_000)
  assert.equal(chooseChatGPTRecoveryAction(state, { thinking: true }, 140_000, { stallMs: 1, reloadSettleMs: 1, actionCooldownMs: 0 }), undefined)
})

test('silent processing reloads once then emits one same-request recovery prompt', () => {
  const state = createChatGPTRecoveryState(1_000)
  const reload = chooseChatGPTRecoveryAction(state, { thinking: false, responseStarted: false }, 31_500, { silentMs: 30_000, actionCooldownMs: 0 })
  assert.equal(reload?.reason, 'silent')
  commitChatGPTRecoveryAction(state, reload, 31_500)
  const prompt = chooseChatGPTRecoveryAction(state, { thinking: false, responseStarted: false }, 47_000, { silentMs: 1, reloadSettleMs: 15_000, actionCooldownMs: 0 })
  assert.equal(prompt?.reason, 'silent-after-reload')
  commitChatGPTRecoveryAction(state, prompt, 47_000)
  assert.equal(chooseChatGPTRecoveryAction(state, {}, 60_000, { silentMs: 1, reloadSettleMs: 1, actionCooldownMs: 0 }), undefined)
})

test('transport recovery is bounded and never loops reloads forever', () => {
  const state = createChatGPTRecoveryState(1_000)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    noteChatGPTRecoveryFault(state, 'net::ERR_CONNECTION_RESET', 2_000 + attempt * 10_000)
    const action = chooseChatGPTRecoveryAction(state, {}, 3_000 + attempt * 10_000, { actionCooldownMs: 0, maxTransportReloads: 3 })
    assert.equal(action?.reason, 'transport')
    commitChatGPTRecoveryAction(state, action, 3_000 + attempt * 10_000)
  }
  noteChatGPTRecoveryFault(state, 'net::ERR_CONNECTION_RESET', 40_000)
  assert.equal(chooseChatGPTRecoveryAction(state, {}, 41_000, { actionCooldownMs: 0, maxTransportReloads: 3 }), undefined)
})

test('transport URL and network error classifiers stay narrow', () => {
  assert.equal(isChatGPTConversationTransportURL('https://chatgpt.com/backend-api/f/conversation/prepare'), true)
  assert.equal(isChatGPTConversationTransportURL('https://chatgpt.com/backend-api/settings'), false)
  assert.equal(isChatGPTConversationTransportURL('https://example.com/backend-api/conversation'), false)
  assert.equal(isRecoverableChatGPTNetworkError('net::ERR_CONNECTION_RESET'), true)
  assert.equal(isRecoverableChatGPTNetworkError('net::ERR_BLOCKED_BY_CLIENT'), false)
})

test('stalled recovery prompt preserves the request and canonical file contract', () => {
  const prompt = chatGPTStalledRecoveryPrompt('req_123', 'wharness-bundle-req_123.zip')
  assert.match(prompt, /SAME REQUEST req_123/)
  assert.match(prompt, /ORIGINAL request/)
  assert.match(prompt, /wharness-bundle-req_123\.zip/)
})

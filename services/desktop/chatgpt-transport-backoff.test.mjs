import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseChatGPTRecoveryAction, createChatGPTRecoveryState, noteChatGPTRecoveryFault, noteChatGPTRecoveryProgress } from './chatgpt-recovery.mjs'
import { createNetworkReloadGate, isNetworkRecoveryFault, networkFaultStatus } from './chatgpt-transport-backoff.mjs'

test('only net::ERR_* faults are network faults; renderer faults keep the immediate reload', () => {
  assert.equal(isNetworkRecoveryFault('net::ERR_NETWORK_CHANGED'), true)
  assert.equal(isNetworkRecoveryFault('renderer process gone: crashed'), false)
  const state = createChatGPTRecoveryState(1_000)
  noteChatGPTRecoveryFault(state, 'renderer process gone: crashed', 2_000)
  assert.equal(chooseChatGPTRecoveryAction(state, {}, 2_001, { actionCooldownMs: 0 })?.type, 'reload')
})

test('a network fault the page heals by itself never reloads', () => {
  const state = createChatGPTRecoveryState(1_000)
  noteChatGPTRecoveryFault(state, 'net::ERR_NETWORK_CHANGED', 2_000)
  assert.equal(networkFaultStatus(state, 5_000), 'deferred')
  noteChatGPTRecoveryProgress(state, 'assistant:2', 6_000)
  assert.equal(networkFaultStatus(state, 30_000), 'recovered')
  assert.equal(chooseChatGPTRecoveryAction(state, {}, 30_000, { actionCooldownMs: 0, faultOnly: true }), undefined)
  assert.equal(state.pendingFault, '')
})

test('a network flap reloads the views one at a time across the Desktop', () => {
  const claim = createNetworkReloadGate(15_000)
  assert.equal(claim(100_000), true)
  assert.equal(claim(100_001), false)
  assert.equal(claim(114_999), false)
  assert.equal(claim(115_000), true)
})

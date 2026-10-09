import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyChatGPTConversationTransport, chooseChatGPTRecoveryAction, commitChatGPTRecoveryAction, createChatGPTRecoveryState, isChatGPTConversationTransportURL, isRecoverableChatGPTNetworkError, noteChatGPTRecoveryFault, reconcileChatGPTConversationTransport, recordChatGPTConversationTransport } from './index.mjs'

test('conversation transport tracker distinguishes active, stale, and idle without trusting a timeout alone', () => {
  const requests = new Map()
  recordChatGPTConversationTransport(requests, 'request-1', 3, 'before', 1_000)

  const active = classifyChatGPTConversationTransport(requests, {
    generation: 3,
    loading: false,
    surfaceReady: true,
    thinking: true,
    lastConversationActivity: 1_000,
  }, 10 * 60_000, { staleMs: 30_000 })
  assert.equal(active.state, 'active')
  assert.deepEqual(active.activeRequestIds, ['request-1'])

  const stale = classifyChatGPTConversationTransport(requests, {
    generation: 3,
    loading: false,
    surfaceReady: true,
    thinking: false,
    lastConversationActivity: 1_000,
  }, 40_000, { staleMs: 30_000 })
  assert.equal(stale.state, 'stale')
  assert.deepEqual(stale.staleRequestIds, ['request-1'])
  reconcileChatGPTConversationTransport(requests, stale)
  assert.equal(requests.size, 0)

  const idle = classifyChatGPTConversationTransport(requests, { generation: 3, surfaceReady: true, thinking: false }, 50_000)
  assert.equal(idle.state, 'idle')
})

test('conversation transport completion/error and navigation generations reconcile orphaned requests categorically', () => {
  const requests = new Map()
  recordChatGPTConversationTransport(requests, 'completed', 4, 'before', 1_000)
  recordChatGPTConversationTransport(requests, 'completed', 4, 'completed', 2_000)
  assert.equal(requests.has('completed'), false)

  recordChatGPTConversationTransport(requests, 'failed', 4, 'before', 3_000)
  recordChatGPTConversationTransport(requests, 'failed', 4, 'error', 4_000)
  assert.equal(requests.has('failed'), false)

  recordChatGPTConversationTransport(requests, 'old-generation', 4, 'before', 5_000)
  const navigated = classifyChatGPTConversationTransport(requests, { generation: 5 }, 5_001)
  assert.equal(navigated.state, 'stale')
  reconcileChatGPTConversationTransport(requests, navigated)
  assert.equal(requests.size, 0)
})

test('recoverable socket and internet errors request a bounded reload first', () => {
  const state = createChatGPTRecoveryState(1_000)
  noteChatGPTRecoveryFault(state, 'net::ERR_INTERNET_DISCONNECTED', 2_000)
  // The page gets the first chance to retry its own stream.
  assert.equal(chooseChatGPTRecoveryAction(state, { thinking: true }, 3_000, { actionCooldownMs: 0 }), undefined)
  const action = chooseChatGPTRecoveryAction(state, { thinking: true }, 22_000, { actionCooldownMs: 0 })
  assert.deepEqual(action, { type: 'reload', reason: 'transport', detail: 'net::ERR_INTERNET_DISCONNECTED' })
  commitChatGPTRecoveryAction(state, action, 22_000)
  assert.equal(state.pendingFault, '')
  assert.equal(state.reloadCount, 1)
})

test('transport URL and network error classifiers stay narrow', () => {
  assert.equal(isChatGPTConversationTransportURL('https://chatgpt.com/backend-api/f/conversation/prepare'), true)
  assert.equal(isChatGPTConversationTransportURL('https://chatgpt.com/backend-api/f/conversation/resume'), true)
  assert.equal(isChatGPTConversationTransportURL('https://chatgpt.com/backend-api/settings'), false)
  assert.equal(isChatGPTConversationTransportURL('https://example.com/backend-api/conversation'), false)
  assert.equal(isRecoverableChatGPTNetworkError('net::ERR_CONNECTION_RESET'), true)
  assert.equal(isRecoverableChatGPTNetworkError('net::ERR_PROXY_CONNECTION_FAILED'), true)
  assert.equal(isRecoverableChatGPTNetworkError('net::ERR_SSL_PROTOCOL_ERROR'), true)
  assert.equal(isRecoverableChatGPTNetworkError('net::ERR_FAILED'), false)
  assert.equal(isRecoverableChatGPTNetworkError('net::ERR_FAILED', { conversationTransport: true }), true)
  assert.equal(isRecoverableChatGPTNetworkError('net::ERR_BLOCKED_BY_CLIENT'), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RATE_LIMIT_GATE,
  RATE_LIMIT_GATE_SELECTORS,
  RATE_LIMIT_TRANSPORT,
  classifyChatGPTRateLimit,
  isChatGPTBackendAPIURL,
} from './chatgpt-rate-limit.mjs'

test('any trusted ChatGPT backend API request counts as rate-limit evidence', () => {
  assert.equal(isChatGPTBackendAPIURL('https://chatgpt.com/backend-api/conversation'), true)
  assert.equal(isChatGPTBackendAPIURL('https://chatgpt.com/backend-api/f/conversation/prepare'), true)
  // The endpoint the narrow conversation-transport predicate ignored.
  assert.equal(isChatGPTBackendAPIURL('https://chatgpt.com/backend-api/lat/r'), true)
  assert.equal(isChatGPTBackendAPIURL('https://ab.chatgpt.com/backend-api/anything'), true)
})

test('untrusted or non-API origins are never rate-limit evidence', () => {
  assert.equal(isChatGPTBackendAPIURL('http://chatgpt.com/backend-api/conversation'), false)
  assert.equal(isChatGPTBackendAPIURL('https://chatgpt.com/c/abc'), false)
  assert.equal(isChatGPTBackendAPIURL('https://evil.example/backend-api/conversation'), false)
  assert.equal(isChatGPTBackendAPIURL('https://notchatgpt.com/backend-api/x'), false)
  assert.equal(isChatGPTBackendAPIURL(''), false)
  assert.equal(isChatGPTBackendAPIURL(undefined), false)
})

test('one throttled request stays on the progressive transport ladder', () => {
  const first = classifyChatGPTRateLimit([], { now: 1_000 })
  assert.equal(first.kind, RATE_LIMIT_TRANSPORT)
  assert.deepEqual(first.hits, [1_000])
})

test('a burst of refusals is an account-wide gate, not backpressure', () => {
  const first = classifyChatGPTRateLimit([], { now: 1_000 })
  const second = classifyChatGPTRateLimit(first.hits, { now: 20_000 })
  assert.equal(second.kind, RATE_LIMIT_GATE)
  assert.equal(second.recentHits, 2)
})

test('refusals spaced beyond the window never escalate to a gate', () => {
  const first = classifyChatGPTRateLimit([], { now: 1_000 })
  const later = classifyChatGPTRateLimit(first.hits, { now: 1_000 + 5 * 60_000 })
  assert.equal(later.kind, RATE_LIMIT_TRANSPORT)
  assert.equal(later.recentHits, 1, 'the stale hit must be pruned, not carried forever')
})

test('ChatGPT exposing its own limit control is conclusive on the first observation', () => {
  const gate = classifyChatGPTRateLimit([], { now: 1_000, domGate: true })
  assert.equal(gate.kind, RATE_LIMIT_GATE)
  assert.equal(gate.domGate, true)
})

test('gate selectors stay structural so detection is language-neutral', () => {
  assert.ok(RATE_LIMIT_GATE_SELECTORS.length > 0)
  for (const selector of RATE_LIMIT_GATE_SELECTORS) {
    assert.match(selector, /^\[data-testid\*=/, `selector ${selector} must match an attribute, never page text`)
  }
})

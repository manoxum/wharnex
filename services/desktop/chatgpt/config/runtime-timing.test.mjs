import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHATGPT_PARTITION, CHATGPT_URL, CHATGPT_LOGIN_URL,
  RETRYABLE_PROMPT_TTL_MS, DELIVERED_BUNDLE_DEDUP_TTL_MS,
  BUNDLE_COMPLETION_CONFIRM_MS, BUNDLE_UNOBSERVED_SETTLE_MS,
  MAX_BUNDLE_CONTINUATIONS, MAX_AUTOMATIC_BUNDLE_CONTINUATIONS,
} from './index.mjs'

test('ChatGPT runtime configuration preserves persisted partition and trusted URLs', () => {
  assert.equal(CHATGPT_PARTITION, 'persist:wharness-chatgpt')
  assert.equal(CHATGPT_URL, 'https://chatgpt.com/')
  assert.equal(CHATGPT_LOGIN_URL, 'https://chatgpt.com/auth/login')
})

test('bundle recovery keeps deduplication and observation bounds', () => {
  assert.equal(DELIVERED_BUNDLE_DEDUP_TTL_MS, RETRYABLE_PROMPT_TTL_MS)
  assert.ok(BUNDLE_UNOBSERVED_SETTLE_MS > BUNDLE_COMPLETION_CONFIRM_MS)
  assert.equal(MAX_BUNDLE_CONTINUATIONS, 3)
  assert.equal(MAX_AUTOMATIC_BUNDLE_CONTINUATIONS, 1)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { confirmChatGPTAffinity, createChatGPTAffinityTracker, markChatGPTAffinitySubmitted, observeChatGPTAffinity, proposeChatGPTAffinity, publicChatGPTAffinity, rejectChatGPTAffinity, syncChatGPTAffinity } from './chatgpt-affinity.mjs'

test('unbound affinity ignores stale concrete navigation until home and a Harness submit are both observed', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', false)
  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/stale' }), '')
  assert.equal(observeChatGPTAffinity(tracker, { home: true }), '')
  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/still-stale' }), '')
  markChatGPTAffinitySubmitted(tracker)
  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/new?model=auto' }), 'https://chatgpt.com/c/new')
  assert.deepEqual(publicChatGPTAffinity(tracker), { affinityPhase: 'candidate', boundConversationUrl: '', bindingCandidate: 'https://chatgpt.com/c/new' })
})

test('candidate survives unrelated observations until renderer validation confirms it', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', true)
  markChatGPTAffinitySubmitted(tracker)
  observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/fast' })
  observeChatGPTAffinity(tracker, { home: true })
  assert.equal(tracker.candidateURL, 'https://chatgpt.com/c/fast')
  assert.equal(confirmChatGPTAffinity(tracker, 'https://chatgpt.com/c/fast'), 'https://chatgpt.com/c/fast')
  assert.equal(tracker.phase, 'bound')
})

test('rejected first candidate rearms new-chat affinity and requires another submit', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', true)
  markChatGPTAffinitySubmitted(tracker)
  observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/conflict' })
  rejectChatGPTAffinity(tracker, 'https://chatgpt.com/c/conflict')
  assert.deepEqual(tracker, { phase: 'armed', boundURL: '', candidateURL: '', homeSeen: false, submitted: false })
})

test('explicit send can propose a different visible conversation while retaining the previous binding until validation', () => {
  const tracker = createChatGPTAffinityTracker('https://chatgpt.com/c/original')
  assert.equal(proposeChatGPTAffinity(tracker, 'https://chatgpt.com/c/other'), 'https://chatgpt.com/c/other')
  assert.deepEqual(publicChatGPTAffinity(tracker), { affinityPhase: 'candidate', boundConversationUrl: 'https://chatgpt.com/c/original', bindingCandidate: 'https://chatgpt.com/c/other' })
  rejectChatGPTAffinity(tracker, 'https://chatgpt.com/c/other')
  assert.equal(tracker.phase, 'bound')
  assert.equal(tracker.boundURL, 'https://chatgpt.com/c/original')
})

test('syncing an existing persisted binding resets stale candidate state', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', true)
  markChatGPTAffinitySubmitted(tracker)
  observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/old' })
  syncChatGPTAffinity(tracker, 'https://chatgpt.com/c/persisted')
  assert.deepEqual(tracker, { phase: 'bound', boundURL: 'https://chatgpt.com/c/persisted', candidateURL: '', homeSeen: false, submitted: false })
})

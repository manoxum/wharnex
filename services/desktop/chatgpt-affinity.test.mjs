import assert from 'node:assert/strict'
import test from 'node:test'
import { confirmChatGPTAffinity, createChatGPTAffinityTracker, isChatGPTAffinityAwaitingSettlement, markChatGPTAffinitySubmitted, observeChatGPTAffinity, proposeChatGPTAffinity, publicChatGPTAffinity, rejectChatGPTAffinity, settleChatGPTAffinity, shouldPreserveChatGPTAffinityNavigation, syncChatGPTAffinity } from './chatgpt-affinity.mjs'

test('unbound affinity observes concrete navigation but publishes only after definitive settlement', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', false)
  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/stale' }), '')
  assert.equal(observeChatGPTAffinity(tracker, { home: true }), '')
  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/still-stale' }), '')
  markChatGPTAffinitySubmitted(tracker)
  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/new?model=auto' }), 'https://chatgpt.com/c/new')
  assert.deepEqual(publicChatGPTAffinity(tracker), { affinityPhase: 'armed', boundConversationUrl: '', bindingCandidate: '' })
  assert.equal(isChatGPTAffinityAwaitingSettlement(tracker), true)
  assert.equal(settleChatGPTAffinity(tracker, 'https://chatgpt.com/c/new?model=auto'), 'https://chatgpt.com/c/new')
  assert.deepEqual(publicChatGPTAffinity(tracker), { affinityPhase: 'candidate', boundConversationUrl: '', bindingCandidate: 'https://chatgpt.com/c/new' })
})

test('transient concrete observations can change before only the settled URL becomes the candidate', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', true)
  markChatGPTAffinitySubmitted(tracker)
  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/first' }), 'https://chatgpt.com/c/first')
  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/final' }), 'https://chatgpt.com/c/final')
  assert.equal(tracker.candidateURL, '')
  assert.equal(settleChatGPTAffinity(tracker, 'https://chatgpt.com/c/final'), 'https://chatgpt.com/c/final')
  assert.equal(tracker.candidateURL, 'https://chatgpt.com/c/final')
  assert.equal(confirmChatGPTAffinity(tracker, 'https://chatgpt.com/c/final'), 'https://chatgpt.com/c/final')
  assert.equal(tracker.phase, 'bound')
})

test('new chats ignore transient WEB conversation URLs and bind the final URL while hidden', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', true)
  markChatGPTAffinitySubmitted(tracker)

  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/WEB:temporary-id' }), '')
  assert.equal(settleChatGPTAffinity(tracker, 'https://chatgpt.com/c/WEB:temporary-id'), '')
  assert.deepEqual(publicChatGPTAffinity(tracker), { affinityPhase: 'armed', boundConversationUrl: '', bindingCandidate: '' })

  assert.equal(observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/final-id' }), 'https://chatgpt.com/c/final-id')
  assert.equal(settleChatGPTAffinity(tracker, 'https://chatgpt.com/c/final-id'), 'https://chatgpt.com/c/final-id')
  assert.equal(confirmChatGPTAffinity(tracker, 'https://chatgpt.com/c/final-id'), 'https://chatgpt.com/c/final-id')
  assert.deepEqual(publicChatGPTAffinity(tracker), { affinityPhase: 'bound', boundConversationUrl: 'https://chatgpt.com/c/final-id', bindingCandidate: '' })
})

test('switching away and back preserves an unbound submitted conversation until binding completes', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', true)
  markChatGPTAffinitySubmitted(tracker)
  assert.equal(shouldPreserveChatGPTAffinityNavigation(tracker), true)

  settleChatGPTAffinity(tracker, 'https://chatgpt.com/c/final-after-background-processing')
  assert.equal(shouldPreserveChatGPTAffinityNavigation(tracker), true)

  confirmChatGPTAffinity(tracker, 'https://chatgpt.com/c/final-after-background-processing')
  assert.equal(shouldPreserveChatGPTAffinityNavigation(tracker), false)
})

test('rejected first settled candidate rearms new-chat affinity and requires another submit', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', true)
  markChatGPTAffinitySubmitted(tracker)
  observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/conflict' })
  settleChatGPTAffinity(tracker, 'https://chatgpt.com/c/conflict')
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

test('explicit confirmation can rebind only to the currently visible concrete conversation', () => {
  const tracker = createChatGPTAffinityTracker('https://chatgpt.com/c/original')
  assert.throws(() => confirmChatGPTAffinity(tracker, 'https://chatgpt.com/c/other'), /conflicts with the current binding/)
  assert.equal(confirmChatGPTAffinity(tracker, 'https://chatgpt.com/c/other?model=auto', 'https://chatgpt.com/c/other'), 'https://chatgpt.com/c/other')
  assert.deepEqual(publicChatGPTAffinity(tracker), { affinityPhase: 'bound', boundConversationUrl: 'https://chatgpt.com/c/other', bindingCandidate: '' })

  const mismatched = createChatGPTAffinityTracker('https://chatgpt.com/c/original')
  assert.throws(() => confirmChatGPTAffinity(mismatched, 'https://chatgpt.com/c/other', 'https://chatgpt.com/c/third'), /conflicts with the current binding/)
})

test('syncing an existing persisted binding resets stale candidate state', () => {
  const tracker = createChatGPTAffinityTracker()
  syncChatGPTAffinity(tracker, '', true)
  markChatGPTAffinitySubmitted(tracker)
  observeChatGPTAffinity(tracker, { conversationUrl: 'https://chatgpt.com/c/old' })
  settleChatGPTAffinity(tracker, 'https://chatgpt.com/c/old')
  syncChatGPTAffinity(tracker, 'https://chatgpt.com/c/persisted')
  assert.deepEqual(tracker, { phase: 'bound', boundURL: 'https://chatgpt.com/c/persisted', candidateURL: '', homeSeen: false, submitted: false })
})

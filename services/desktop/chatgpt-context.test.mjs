import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldAttachProjectContext } from './chatgpt-context.mjs'

test('first prompt and changed project snapshot attach context', () => {
  assert.equal(shouldAttachProjectContext({ currentSha: 'a', previousSha: '', currentConversationId: 'c1', previousConversationId: '' }), true)
  assert.equal(shouldAttachProjectContext({ currentSha: 'b', previousSha: 'a', currentConversationId: 'c1', previousConversationId: 'c1' }), true)
})

test('same conversation and unchanged snapshot omit duplicate context', () => {
  assert.equal(shouldAttachProjectContext({ currentSha: 'a', previousSha: 'a', currentConversationId: 'c1', previousConversationId: 'c1' }), false)
})

test('new concrete ChatGPT URL forces a fresh project context', () => {
  assert.equal(shouldAttachProjectContext({ currentSha: 'a', previousSha: 'a', currentConversationId: 'c2', previousConversationId: 'c1' }), true)
})

test('new-chat surface without a concrete id refreshes context when leaving a bound conversation', () => {
  assert.equal(shouldAttachProjectContext({ currentSha: 'a', previousSha: 'a', currentConversationId: '', previousConversationId: 'c1' }), true)
})

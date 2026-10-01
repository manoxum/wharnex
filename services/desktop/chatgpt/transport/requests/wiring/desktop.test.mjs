import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopPromptDispatch } from './desktop.mjs'

test('prompt dispatch composes draft and request operations without invoking late bindings', () => {
  let lateReads = 0
  const later = () => { lateReads += 1; return 'later' }
  const dispatch = createDesktopPromptDispatch({
    durableWorkspaceChatID: later,
    persistWorkspaceChatRemoteBestEffort: later,
    enqueueChatAgentFollowups: later,
    getChatAgentScheduler: later,
    enqueueChatAgentTask: later,
  })
  assert.equal(lateReads, 0)
  assert.equal(typeof dispatch.submitChatGPTDraft, 'function')
  assert.equal(typeof dispatch.preparePromptForChatGPT, 'function')
  assert.equal(typeof dispatch.submitChatGPTContinuation, 'function')
  assert.equal(dispatch.durableWorkspaceChatID, later)
  assert.equal(dispatch.enqueueChatAgentFollowups, later)
})

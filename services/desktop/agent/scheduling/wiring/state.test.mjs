import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopSchedulingState } from './state.mjs'
import { createDesktopRuntimeState } from '../../../composition/state/runtime.mjs'

test('scheduling state remains live across agent, provider and window owners', () => {
  const { agent: agentRuntime, chatgpt: chatgptRuntime, window: windowRuntime } = createDesktopRuntimeState({
    clipboard: {}, ClipboardItem: class {}, publishAgentState() {}, publishChatGPTState() {},
  })
  agentRuntime.desiredChatAgentWorkerSlots = 3
  agentRuntime.chatAgentRuntimeDiagnostics.queue.due = 1
  agentRuntime.chatAgentScheduler = { id: 1 }
  chatgptRuntime.chatGPTRateLimitUntil = 10
  chatgptRuntime.chatGPTRateLimitResumeProbeRequired = true
  const state = createDesktopSchedulingState({ agentRuntime, chatgptRuntime, windowRuntime })
  assert.equal(state.desiredChatAgentWorkerSlots, 3)
  assert.equal(state.chatAgentRuntimeDiagnostics.queue.due, 1)
  assert.equal(state.chatAgentScheduler.id, 1)
  assert.equal(state.chatGPTRateLimitUntil, 10)
  state.desiredChatAgentWorkerSlots = 4
  state.chatGPTRateLimitUntil = 20
  state.chatGPTRateLimitResumeProbeRequired = false
  windowRuntime.quitting = true
  assert.equal(agentRuntime.desiredChatAgentWorkerSlots, 4)
  assert.equal(chatgptRuntime.chatGPTRateLimitUntil, 20)
  assert.equal(chatgptRuntime.chatGPTRateLimitResumeProbeRequired, false)
  assert.equal(state.quitting, true)
})

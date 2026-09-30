import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopSchedulingState } from './state.mjs'

test('scheduling state remains live across agent, provider and window owners', () => {
  const agentRuntime = { desiredWorkerSlots: 3, diagnostics: { queue: { due: 1 } }, workerScheduler: { id: 1 } }
  const chatgptRuntime = { rateLimitUntil: 10, rateLimitResumeProbeRequired: true }
  const windowRuntime = { quitting: false }
  const state = createDesktopSchedulingState({ agentRuntime, chatgptRuntime, windowRuntime })
  assert.equal(state.desiredChatAgentWorkerSlots, 3)
  assert.equal(state.chatAgentRuntimeDiagnostics.queue.due, 1)
  assert.equal(state.chatAgentScheduler.id, 1)
  assert.equal(state.chatGPTRateLimitUntil, 10)
  state.desiredChatAgentWorkerSlots = 4
  state.chatGPTRateLimitUntil = 20
  state.chatGPTRateLimitResumeProbeRequired = false
  windowRuntime.quitting = true
  assert.equal(agentRuntime.desiredWorkerSlots, 4)
  assert.equal(chatgptRuntime.rateLimitUntil, 20)
  assert.equal(chatgptRuntime.rateLimitResumeProbeRequired, false)
  assert.equal(state.quitting, true)
})

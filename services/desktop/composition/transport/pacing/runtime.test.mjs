import assert from 'node:assert/strict'
import test from 'node:test'
import { createDesktopChatGPTPacing } from './runtime.mjs'

test('pacing composition keeps health, resume, and upload callbacks live', () => {
  const state = { until: Date.now() + 1000, resumeProbeRequired: false }
  const d = {
    rateLimitState: state, chatGPTWorkerEntries: [],
    getRuntimeDiagnostics: () => ({ provider: { rate_limit_level: 0 } }),
    CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS: 10_000,
    CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS: 60_000,
  }
  const runtime = createDesktopChatGPTPacing(d)
  assert.equal(typeof runtime.recoverChatGPTConversationLoadFailure, 'function')
  assert.equal(typeof runtime.pasteChatGPTFile, 'function')
  assert.equal(runtime.chatAgentNavigationGapMs(), 10_000)
  assert.ok(runtime.chatAgentRateLimitDelayMs() > 0)
  state.until = 0
  assert.equal(runtime.chatAgentRateLimitDelayMs(), 0)
})

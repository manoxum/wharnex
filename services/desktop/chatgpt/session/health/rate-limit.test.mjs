import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTRateLimit } from './index.mjs'

test('DOM gate raises the local Worker cooldown and persists provider evidence once', async () => {
  const recorded = []
  const activity = []
  const expected = { recovery: {}, backoffUntil: 0 }
  const state = {
    hits: [], until: 0, resumeProbeRequired: false, kind: '', appliedAt: 0,
    policies: { rate_limit_cooldown_minutes: 2 }, runtimeDiagnostics: { provider: {} },
    scheduler: { recordRateLimit: async (...args) => {
      recorded.push(args)
      return { paused_until: new Date(Date.now() + 4 * 60_000).toISOString() }
    } },
  }
  const health = createChatGPTRateLimit({
    state, classifyChatGPTRateLimit: (hits, { domGate }) => ({ hits: [...hits, Date.now()], kind: domGate ? 'gate' : 'isolated', recentHits: hits.length + 1 }),
    RATE_LIMIT_GATE: 'gate', CHATGPT_RATE_LIMIT_BACKOFF_MS: 7.5 * 60_000,
    expectedChatGPTBundles: new Map([['chat', expected]]),
    noteChatGPTRecoveryProgress: () => {}, publishChatAgentRuntimeState: () => {},
    sendToChatGPTKey: (_key, _channel, payload) => activity.push(payload),
  })
  assert.equal(health.noteChatGPTRateLimitGate('chat', { rateLimited: false }), false)
  assert.equal(state.until, 0)
  assert.equal(health.noteChatGPTRateLimitGate('chat', { rateLimited: true }), true)
  assert.equal(state.kind, 'gate')
  assert.equal(state.resumeProbeRequired, true)
  assert.ok(state.until > Date.now() + 119_000)
  assert.ok(expected.backoffUntil >= state.until - 1000)
  assert.equal(recorded.length, 1)
  assert.deepEqual(recorded[0], ['dom_gate', 'gate', 120])
  assert.match(activity[0].text, /Workers ficam suspensos por 2 minutos/)
  health.noteChatGPTRateLimitGate('chat', { rateLimited: true })
  assert.equal(recorded.length, 1, 'repeated evidence must not restart the durable pause')
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(state.until > Date.now() + 3 * 60_000, 'the persisted deadline extends the local mirror')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerPacing } from './worker-pacing.mjs'

function fixture({ provider = {}, cooldown = 0, stale = false } = {}) {
  const events = []
  const pacing = createWorkerPacing({
    getRuntimeDiagnostics: () => ({ provider }),
    CHATGPT_RATE_LIMIT_HEALTHY_WINDOW_MS: 60_000,
    CHATGPT_WORKER_NAVIGATION_GAP_HEALTHY_MS: 2_000,
    CHATGPT_WORKER_NAVIGATION_GAP_MS: 30_000,
    CHAT_AGENT_WORKER_ACTION_GAP_MS: 10_000,
    chatAgentWorkerActivity: {
      pacePriority: () => 1,
      during: async (_phase, operation) => operation(),
      markProviderAction: () => events.push('provider-action'),
    },
    chatGPTWorkerPacer: { pace: async (measure, options) => events.push(`pace:${measure()}:${options.minimumGapMs}`) },
    CHAT_AGENT_SUBMIT_GAP_MS: 10_000,
    CHAT_AGENT_SUBMIT_GAP_RECOVERY_MS: 60_000,
    CHAT_AGENT_TRANSLATION_ACTION_GAP_MS: 3_000,
    chatAgentRateLimitDelayMs: () => cooldown,
    loadOwnedChatGPTURL: async () => events.push('navigate'),
    waitForChatGPTSurfaceReady: async () => events.push('ready'),
    chatAgentResidency: { settleAssignment: () => !stale },
  })
  return { pacing, events }
}

test('healthy provider paces navigation at its floor', async () => {
  const { pacing, events } = fixture()
  await pacing.paceChatGPTWorkerNavigation()
  assert.deepEqual(events, ['pace:2000:10000', 'provider-action'])
})

test('durable 429 pressure widens the navigation and submission gaps', () => {
  const provider = { rate_limit_level: 3, last_rate_limit_at: new Date().toISOString() }
  const { pacing } = fixture({ provider })
  assert.equal(pacing.chatAgentNavigationGapMs(), 30_000)
  assert.equal(pacing.chatAgentSubmissionGapMs(), 45_000)
})

test('cooldown raised during pacing prevents navigation', async () => {
  const { pacing, events } = fixture({ cooldown: 30_000 })
  await assert.rejects(
    pacing.loadAndSettleChatGPTWorkerConversation('chat-1', { slotId: 'worker-1' }, 'https://chatgpt.com/c/1', 'task'),
    (error) => error instanceof pacing.ChatGPTRateLimitDeferral && error.delayMs === 30_000,
  )
  assert.deepEqual(events, ['pace:2000:10000', 'provider-action'])
})

test('navigation rejects a stale Worker assignment after page readiness', async () => {
  const { pacing, events } = fixture({ stale: true })
  await assert.rejects(
    pacing.loadAndSettleChatGPTWorkerConversation('chat-1', { slotId: 'worker-1' }, 'https://chatgpt.com/c/1', 'task', { rebind: true, epoch: 2, lane: 'chat-1' }),
    /stale worker assignment/,
  )
  assert.deepEqual(events, ['pace:2000:10000', 'provider-action', 'navigate', 'ready'])
})

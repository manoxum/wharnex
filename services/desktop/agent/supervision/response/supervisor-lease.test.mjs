import test from 'node:test'
import assert from 'node:assert/strict'
import { createSupervisorResponseLease } from './supervisor-lease.mjs'

function fixture({ delivered = false, pending = false, manual = false, progressAt = Date.now(), createdAt = new Date().toISOString() } = {}) {
  const events = []
  const expected = { requestId: 'req-1', filename: 'response.zip', progressAt }
  const { superviseChatAgentResponse } = createSupervisorResponseLease({
    hydrateExpectedChatAgentBundle: () => expected,
    recentlyDeliveredChatGPTBundleRequestId: () => delivered,
    disarmExpectedChatGPTBundle: () => events.push('disarm'),
    pendingChatGPTBundleDeliveries: new Set(pending ? ['req-1'] : []),
    CHAT_AGENT_AWAIT_PROBE_MS: 30_000,
    chatgptTransportModes: new Map(manual ? [['chat-1', 'manual']] : []),
    chatGPTHumanActionMessage: (kind) => `human:${kind}`,
    pollExpectedChatGPTDownloadKey: () => events.push('poll'),
    AWAIT_STALL_ATTENTION_MS: 60_000,
    EXPECTED_BUNDLE_TTL_MS: 3_600_000,
  })
  const run = (entry = {}) => superviseChatAgentResponse({ created_at: createdAt }, entry, 'chat-1', {})
  return { run, events }
}

test('delivered request disarms supervision without polling the provider', async () => {
  const { run, events } = fixture({ delivered: true })
  assert.deepEqual(await run(), { status: 'done' })
  assert.deepEqual(events, ['disarm'])
})

test('pending local delivery waits at the healthy observation cadence', async () => {
  const { run, events } = fixture({ pending: true })
  assert.deepEqual(await run(), {
    status: 'waiting', delayMs: 30_000, observation: true,
    error: 'a entrega do bundle validado está a concluir',
  })
  assert.deepEqual(events, [])
})

test('structural silence and durable task age require human attention', async () => {
  const silent = fixture({ progressAt: Date.now() - 61_000 })
  assert.equal((await silent.run()).status, 'attention')
  const old = fixture({ createdAt: new Date(Date.now() - 3_600_100).toISOString() })
  assert.equal((await old.run()).status, 'attention')
  assert.deepEqual(old.events, ['poll'])
})

test('manual transport and active human action stop unattended observation', async () => {
  assert.deepEqual(await fixture({ manual: true }).run(), { status: 'done' })
  const { run, events } = fixture()
  assert.deepEqual(await run({ humanAction: { active: true, kind: 'verification' } }), {
    status: 'attention', error: 'human:verification',
  })
  assert.deepEqual(events, [])
})

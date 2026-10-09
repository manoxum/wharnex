import test from 'node:test'
import assert from 'node:assert/strict'
import { createResponseLineage } from './lineage.mjs'
import { createResponseProbe } from './probe.mjs'
import { createSupervisorResponseLease } from './supervisor-lease.mjs'

function fixture() {
  const task = { task_id: 'old-await', request_id: 'req-1', chat_id: 'chat-1' }
  const payload = { observation_only: false, recovery_count: 0 }
  const expectations = new Map()
  const writes = []
  const scheduler = {
    list: async () => ({ tasks: [{ ...task, type: 'AWAIT_RESPONSE', payload }] }),
    requestEvents: async () => ({ events: [{ task_id: task.task_id, request_id: task.request_id,
      chat_id: '', type: 'chatgpt.recovery_keep_continue' }] }),
  }
  const lineage = createResponseLineage({
    getScheduler: () => scheduler, expectedChatGPTBundles: expectations,
    armExpectedChatGPTBundle: (key, requestId) => expectations.set(key, { requestId, filename: 'response.zip' }),
    MAX_AUTOMATIC_BUNDLE_CONTINUATIONS: 1, chatGPTBundleAlreadyValidated: () => false,
    BUNDLE_CONTINUATION_BASE_MS: 0, enqueueChatAgentTask: async (...args) => writes.push(args),
    CHAT_AGENT_AWAIT_PROBE_MS: 30_000,
  })
  return { task, payload, expectations, writes, lineage, scheduler }
}

test('cold legacy hydration cannot repeat a continuation already spent by its owned task', async () => {
  const { task, payload, writes, lineage } = fixture()
  const expected = await lineage.hydrateExpectedChatAgentBundle('chat-1', task, payload)
  const result = await lineage.enqueueChatAgentContinuation(task, 'chat-1', expected, payload,
    'https://chatgpt.com/c/one', Date.now(), 'completed-without-bundle')
  assert.equal(writes.length, 0)
  assert.equal(expected.rehydrating, true)
  assert.equal(expected.continuationCount, 1)
  assert.equal(expected.mainRequestTaskId, 'old-await')
  assert.equal(result.observation, true)
})

test('fresh already armed supervision retains ordinary processing while passive payload reinforces its guard', async () => {
  const { task, payload, expectations, lineage } = fixture()
  const fresh = { requestId: 'req-1', rehydrating: false, continuationCount: 0, armedAt: 123, progressAt: 456 }
  expectations.set('chat-1', fresh)
  assert.equal(await lineage.hydrateExpectedChatAgentBundle('chat-1', task, payload), fresh)
  assert.equal(fresh.rehydrating, false)
  assert.equal(fresh.armedAt, 123)
  assert.equal(fresh.progressAt, 456)
  await lineage.hydrateExpectedChatAgentBundle('chat-1', task, { ...payload, observation_only: true, recovery_count: 1 })
  assert.equal(fresh.rehydrating, true)
  assert.equal(fresh.continuationCount, 1)
})

test('response probe waits for cold hydration before deciding Supervisor ownership', async () => {
  const { task, payload, expectations, lineage } = fixture()
  const { probeChatAgentResponse } = createResponseProbe({
    hydrateExpectedChatAgentBundle: lineage.hydrateExpectedChatAgentBundle,
    CHAT_AGENT_AWAIT_PROBE_MS: 30_000,
    chatGPTSupervisorOwnsExpectedResponse: (_key, requestId) => {
      assert.equal(requestId, 'req-1')
      assert.equal(expectations.get('chat-1').continuationCount, 1)
      return true
    },
  })
  assert.equal((await probeChatAgentResponse(task, {}, 'chat-1', payload, '')).observation, true)
})

test('Supervisor lease waits for durable hydration before scheduling its resident poll', async () => {
  const { task, payload, expectations, lineage } = fixture()
  let polled = false
  const { superviseChatAgentResponse } = createSupervisorResponseLease({
    hydrateExpectedChatAgentBundle: lineage.hydrateExpectedChatAgentBundle,
    recentlyDeliveredChatGPTBundleRequestId: () => false,
    pendingChatGPTBundleDeliveries: new Set(), chatgptTransportModes: new Map(),
    pollExpectedChatGPTDownloadKey: () => {
      assert.equal(expectations.get('chat-1').rehydrating, true)
      assert.equal(expectations.get('chat-1').continuationCount, 1)
      polled = true
    },
    CHAT_AGENT_AWAIT_PROBE_MS: 30_000, AWAIT_STALL_ATTENTION_MS: 60_000, EXPECTED_BUNDLE_TTL_MS: 3_600_000,
  })
  assert.equal((await superviseChatAgentResponse(task, {}, 'chat-1', payload)).observation, true)
  assert.equal(polled, true)
})

test('fresh same-request dispatch during history restoration retains its live guard, age and budget', async () => {
  const { task, payload, expectations, lineage, scheduler } = fixture()
  let release
  scheduler.list = () => new Promise((resolve) => { release = resolve })
  const restoring = lineage.hydrateExpectedChatAgentBundle('chat-1', task, payload)
  const fresh = { requestId: 'req-1', rehydrating: false, continuationCount: 2, armedAt: 123, progressAt: 456, mainRequestTaskId: 'new-await' }
  expectations.set('chat-1', fresh)
  release({ tasks: [task] })
  assert.equal(await restoring, fresh)
  assert.equal(fresh.rehydrating, false)
  assert.equal(fresh.continuationCount, 2)
  assert.equal(fresh.armedAt, 123)
  assert.equal(fresh.progressAt, 456)
  assert.equal(fresh.mainRequestTaskId, 'new-await')
})

test('history restoration cannot overwrite a different request armed while it awaited the ledger', async () => {
  const { task, payload, expectations, lineage, scheduler } = fixture()
  let release
  scheduler.list = () => new Promise((resolve) => { release = resolve })
  const restoring = lineage.hydrateExpectedChatAgentBundle('chat-1', task, payload)
  const replacement = { requestId: 'new-request', rehydrating: false, continuationCount: 0 }
  expectations.set('chat-1', replacement)
  release({ tasks: [task] })
  await assert.rejects(restoring, /changed during response restoration/)
  assert.equal(expectations.get('chat-1'), replacement)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createResponseProbe } from './probe.mjs'

const task = { task_id: 'task-1' }
const entry = { view: { webContents: { getURL: () => 'https://chatgpt.com/c/other' } } }
const expected = { requestId: 'req-1' }

function probeWith(overrides = {}) {
  const calls = []
  const context = {
    hydrateExpectedChatAgentBundle: () => expected,
    chatGPTSupervisorOwnsExpectedResponse: () => false,
    CHAT_AGENT_AWAIT_PROBE_MS: 30_000,
    recentlyDeliveredChatGPTBundleRequestId: () => false,
    pendingChatGPTBundleDeliveries: new Set(),
    disarmExpectedChatGPTBundle: () => calls.push('disarm'),
    sameConversationURL: (left, right) => left === right,
    orchestratorTaskChat: () => false,
    paceChatGPTWorkerNavigation: async () => calls.push('pace'),
    loadOwnedChatGPTURL: async () => calls.push('navigate'),
    waitForChatGPTSurfaceReady: async () => calls.push('page-read'),
    ...overrides,
  }
  return { probe: createResponseProbe(context).probeChatAgentResponse, calls }
}

test('Supervisor ownership returns a free observation without reading or navigating the Worker page', async () => {
  const { probe, calls } = probeWith({ chatGPTSupervisorOwnsExpectedResponse: () => true })
  const result = await probe(task, entry, 'owned', {}, 'https://chatgpt.com/c/owned')
  assert.deepEqual(result, {
    status: 'waiting', delayMs: 30_000, observation: true,
    error: 'visible Supervisor owns response supervision',
  })
  assert.deepEqual(calls, [])
})

test('a delivered bundle disarms supervision before any Worker page access', async () => {
  const { probe, calls } = probeWith({ recentlyDeliveredChatGPTBundleRequestId: () => true })
  assert.deepEqual(await probe(task, entry, 'owned', {}, 'https://chatgpt.com/c/owned'), { status: 'done' })
  assert.deepEqual(calls, ['disarm'])
})

test('a Worker on another ordinary conversation yields without navigation', async () => {
  const { probe, calls } = probeWith()
  const result = await probe(task, entry, 'owned', {}, 'https://chatgpt.com/c/owned')
  assert.deepEqual(result, {
    status: 'waiting', delayMs: 30_000, observation: true,
    error: 'resident worker is no longer on the expected conversation',
  })
  assert.deepEqual(calls, [])
})

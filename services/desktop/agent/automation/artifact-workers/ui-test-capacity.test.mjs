import test from 'node:test'
import assert from 'node:assert/strict'
import { UI_TEST_RUN_CONCURRENCY, uiTestRunSlots } from './ui-test-capacity.mjs'
import { createEphemeralWorkerRuntime } from './ephemeral-runtime.mjs'

test('UI test runs stop being claimed at the soft cap and resume as runs settle', async () => {
  const releases = []
  const runtime = createEphemeralWorkerRuntime({
    EPHEMERAL_WORKER_TASK_TYPES: new Set(['UI_TEST_RUN']), EPHEMERAL_WORKER_IDLE_RETIRE_MS: 1, EPHEMERAL_WORKER_PACE_PRIORITY: 1,
    ephemeralWorkerViews: new Map(), chatGPTWorkerEntries: [], desktopWindows: new Map([[1, { window: { isDestroyed: () => false } }]]),
    retireChatGPTWorkerView: () => {}, createChatGPTWorkerView: () => ({ slotId:'s', view:{ webContents:{ isDestroyed: () => false } } }),
    publishChatAgentRuntimeState: () => {}, chatAgentWorkerActivity: { run: (_slot, _task, work) => work() },
    executeChatTranslatorTask: async () => ({}), executeChatAgentTask: () => new Promise((resolve) => releases.push(() => resolve({ status:'done' }))),
    parkChatGPTWorkerAfterLoadFailure: () => {}, releaseChatGPTConversationReadProbe: () => {}, schedule: () => ({}),
  })
  const runs = Array.from({ length: UI_TEST_RUN_CONCURRENCY }, (_, i) => runtime.executeEphemeralWorkerTask({ type:'UI_TEST_RUN', task_id:`cat_${i}` }))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(uiTestRunSlots.excludedTypes(), ['UI_TEST_RUN'])
  const overflow = await runtime.executeEphemeralWorkerTask({ type:'UI_TEST_RUN', task_id:'cat_over' })
  assert.deepEqual([overflow.status, overflow.observation], ['waiting', true], 'a run claimed above the cap returns as a free observation')
  releases.shift()()
  await runs[0]
  assert.deepEqual(uiTestRunSlots.excludedTypes(), [])
  for (const release of releases) release()
  await Promise.all(runs)
  assert.equal(uiTestRunSlots.active(), 0)
})

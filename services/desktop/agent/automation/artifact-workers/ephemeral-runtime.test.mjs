import test from 'node:test'
import assert from 'node:assert/strict'
import { createEphemeralWorkerRuntime } from './ephemeral-runtime.mjs'

function fixture(results = []) {
  const events = []
  const views = new Map()
  const workers = []
  let tick = () => {}
  let time = 0
  const runtime = createEphemeralWorkerRuntime({
    EPHEMERAL_WORKER_TASK_TYPES: new Set(['TRANSLATE_MARKDOWN', 'ORCHESTRATOR_PLAN', 'RELEASE_NOTES']),
    EPHEMERAL_WORKER_IDLE_RETIRE_MS: 100, EPHEMERAL_WORKER_PACE_PRIORITY: 2,
    ephemeralWorkerViews: views, chatGPTWorkerEntries: workers,
    desktopWindows: new Map([['host', { window: { isDestroyed: () => false } }]]),
    retireChatGPTWorkerView: (entry) => events.push(`retire:${entry.slotId}`),
    createChatGPTWorkerView: (id) => {
      const entry = { slotId: id, view: { webContents: { isDestroyed: () => false } } }
      workers.push(entry)
      events.push(`create:${id}`)
      return entry
    },
    publishChatAgentRuntimeState: () => events.push('publish'),
    chatAgentWorkerActivity: { run: async (_, __, operation, options) => {
      assert.equal(options.priority, 2)
      return operation()
    } },
    executeChatTranslatorTask: async () => ({ status: 'completed' }),
    executeChatAgentTask: async () => results.shift() || { status: 'completed' },
    parkChatGPTWorkerAfterLoadFailure: (entry) => events.push(`park:${entry.slotId}`),
    releaseChatGPTConversationReadProbe: (id) => events.push(`release:${id}`),
    schedule: (callback) => { tick = callback; return { unref() {} } },
    now: () => time,
  })
  return { runtime, events, views, workers, tick: () => tick(), advance: (ms) => { time += ms } }
}

test('waiting task keeps the same ephemeral view; completion retires it', async () => {
  const { runtime, events, views, workers } = fixture([{ status: 'waiting' }, { status: 'completed' }])
  const task = { task_id: 'task-1', type: 'ORCHESTRATOR_PLAN' }
  assert.deepEqual(await runtime.executeEphemeralWorkerTask(task), { status: 'waiting' })
  assert.equal(views.size, 1)
  assert.deepEqual(await runtime.executeEphemeralWorkerTask(task), { status: 'completed' })
  assert.equal(views.size, 0)
  assert.equal(workers.length, 0)
  assert.equal(events.filter((event) => event.startsWith('create:')).length, 1)
  assert.deepEqual(events.filter((event) => event.startsWith('park:')).length, 2)
})

test('idle task view retires and unrelated task type fails closed', async () => {
  const { runtime, views, tick, advance } = fixture([{ status: 'waiting' }])
  assert.equal((await runtime.executeEphemeralWorkerTask({ task_id: 'x', type: 'BOT_WRITE' })).status, 'failed')
  await runtime.executeEphemeralWorkerTask({ task_id: 'x', type: 'RELEASE_NOTES' })
  advance(101)
  tick()
  assert.equal(views.size, 0)
})

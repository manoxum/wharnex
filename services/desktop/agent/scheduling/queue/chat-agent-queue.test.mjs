import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatAgentQueue, settleJob, TASK_TYPES } from './chat-agent-queue.mjs'

test('typed queue prioritizes bot write over due await and lifecycle', async () => {
  let now = 1_000
  const queue = new ChatAgentQueue({ now: () => now })
  const archive = queue.enqueueTask({ type: 'ARCHIVE_CHAT', chatId: 'a' })
  const awaitResponse = queue.enqueueTask({ type: 'AWAIT_RESPONSE', chatId: 'b' })
  const write = queue.enqueueTask({ type: 'BOT_WRITE', chatId: 'c' })
  const first = queue.take()
  const second = queue.take()
  const third = queue.take()
  assert.equal(first.type, 'BOT_WRITE')
  assert.equal(second.type, 'AWAIT_RESPONSE')
  assert.equal(third.type, 'ARCHIVE_CHAT')
  settleJob(first, null, true)
  settleJob(second, null, true)
  settleJob(third, null, true)
  await Promise.all([archive, awaitResponse, write])
})


test('markdown translation outranks ordinary chat writes', async () => {
  const queue = new ChatAgentQueue()
  const write = queue.enqueueTask({ type: 'BOT_WRITE', chatId: 'write' })
  const translation = queue.enqueueTask({ type: 'TRANSLATE_MARKDOWN', chatId: 'translation' })
  const first = queue.take()
  const second = queue.take()
  assert.equal(first.type, 'TRANSLATE_MARKDOWN')
  assert.equal(second.type, 'BOT_WRITE')
  settleJob(first, null, true)
  settleJob(second, null, true)
  await Promise.all([write, translation])
})

test('global utility bands put translation before planning before execution', async () => {
  const queue = new ChatAgentQueue()
  const execution = queue.enqueueTask({ type: 'ORCHESTRATOR_EXECUTE', chatId: 'execute' })
  const planning = queue.enqueueTask({ type: 'ORCHESTRATOR_PLAN', chatId: 'plan' })
  const translation = queue.enqueueTask({ type: 'TRANSLATE_MARKDOWN', chatId: 'translate' })
  const claimed = [queue.take(), queue.take(), queue.take()]
  assert.deepEqual(claimed.map((task) => task?.type), ['TRANSLATE_MARKDOWN', 'ORCHESTRATOR_PLAN', 'ORCHESTRATOR_EXECUTE'])
  claimed.forEach((task) => settleJob(task, null, true))
  await Promise.all([execution, planning, translation])
})

test('orchestrator planning is highest priority and dedupes one durable request', async () => {
  const queue = new ChatAgentQueue()
  const write = queue.enqueueTask({ type: 'BOT_WRITE', chatId: 'write' })
  const planning = queue.enqueueTask({ type: 'ORCHESTRATOR_PLAN', chatId: 'orp', dedupeKey: 'orchestrator:orp_1' })
  const duplicate = queue.enqueueTask({ type: 'ORCHESTRATOR_PLAN', chatId: 'orp', dedupeKey: 'orchestrator:orp_1' })
  assert.equal(planning, duplicate)
  const first = queue.take()
  const second = queue.take()
  assert.equal(first.type, 'ORCHESTRATOR_PLAN')
  assert.equal(second.type, 'BOT_WRITE')
  settleJob(first, null, true)
  settleJob(second, null, true)
  await Promise.all([write, planning])
})

test('not_before keeps bounded probes out of contention', async () => {
  let now = 1_000
  const queue = new ChatAgentQueue({ now: () => now })
  const pending = queue.enqueueTask({ type: 'AWAIT_RESPONSE', chatId: 'a', notBefore: 10_000 })
  assert.equal(queue.take(), undefined)
  now = 10_000
  const job = queue.take()
  assert.equal(job.type, 'AWAIT_RESPONSE')
  settleJob(job, null, true)
  await pending
})

test('active bot writes dedupe by semantic key just like other durable work', async () => {
  const queue = new ChatAgentQueue()
  const first = queue.enqueueTask({ type: 'AWAIT_RESPONSE', chatId: 'a', dedupeKey: 'await:req' })
  const again = queue.enqueueTask({ type: 'AWAIT_RESPONSE', chatId: 'a', dedupeKey: 'await:req' })
  assert.equal(first, again)
  const write1 = queue.enqueueTask({ type: 'BOT_WRITE', chatId: 'a', dedupeKey: 'write:req' })
  const write2 = queue.enqueueTask({ type: 'BOT_WRITE', chatId: 'a', dedupeKey: 'write:req' })
  assert.equal(write1, write2)
  assert.equal(queue.depth, 2)
  queue.cancelAll()
  await Promise.allSettled([first, write1, write2])
})

test('aging promotes maintenance without overtaking P0 writes', async () => {
  let now = 0
  const queue = new ChatAgentQueue({ now: () => now })
  const cleanup = queue.enqueueTask({ type: 'DELETE_BUNDLE', chatId: 'a' })
  now = 60 * 60_000
  const awaitResponse = queue.enqueueTask({ type: 'AWAIT_RESPONSE', chatId: 'b' })
  const write = queue.enqueueTask({ type: 'BOT_WRITE', chatId: 'c' })
  const first = queue.take()
  const second = queue.take()
  assert.equal(first.type, 'BOT_WRITE')
  assert.equal(second.type, 'DELETE_BUNDLE')
  settleJob(first, null, true)
  settleJob(second, null, true)
  queue.cancelAll()
  await Promise.allSettled([cleanup, awaitResponse, write])
})


test('TODO classification stays behind user-facing work but ages normally', async () => {
  const queue = new ChatAgentQueue()
  const classify = queue.enqueueTask({ type: 'TODO_CLASSIFY', chatId: 'todo' })
  const archive = queue.enqueueTask({ type: 'ARCHIVE_CHAT', chatId: 'archive' })
  const first = queue.take()
  const second = queue.take()
  assert.equal(first.type, 'ARCHIVE_CHAT')
  assert.equal(second.type, 'TODO_CLASSIFY')
  settleJob(first, null, true)
  settleJob(second, null, true)
  await Promise.all([classify, archive])
})

test('task catalog covers approved scheduler verbs', () => {
  for (const type of ['TRANSLATE_MARKDOWN', 'RELEASE_NOTES', 'UI_TEST_DISCOVER', 'UI_TEST_RUN', 'TODO_CLASSIFY', 'ORCHESTRATOR_PLAN', 'BOT_WRITE', 'RECOVERY_WRITE', 'AWAIT_RESPONSE', 'TITLE_DISCOVER', 'ORGANIZE_CHAT', 'ARCHIVE_CHAT', 'DELETE_CHAT', 'DELETE_BUNDLE', 'DELETE_TEMP_CHAT']) {
    assert.ok(TASK_TYPES.includes(type), type)
  }
})

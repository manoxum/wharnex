import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkerActivity } from './chat-agent-worker-activity.mjs'

test('a task run records its phases per Worker and clears them when it settles', async () => {
  let now = 1_000
  const changes = []
  const activity = new WorkerActivity({ now: () => now, onChange: () => changes.push(1) })
  let inside
  await activity.run('worker-2', 'cat_a', async () => {
    activity.set('navigating')
    now = 2_000
    activity.set('uploading')
    inside = activity.snapshot('worker-2')
  })
  assert.deepEqual(inside, { phase: 'uploading', since: new Date(2_000).toISOString(), task_id: 'cat_a' })
  assert.equal(activity.snapshot('worker-2'), null)
  assert.ok(changes.length >= 3)
})

test('a phase set outside a task context is ignored rather than misattributed', () => {
  const activity = new WorkerActivity()
  activity.set('submitting')
  assert.equal(activity.snapshot('worker-1'), null)
})

test('an event handler can update the Worker that owns the page', async () => {
  const activity = new WorkerActivity()
  await activity.run('worker-3', 'cat_b', async () => {
    activity.set('processing')
    activity.setFor('worker-3', 'downloading')
    assert.equal(activity.snapshot('worker-3').phase, 'downloading')
    // A page with no running task is not given a phase.
    activity.setFor('worker-9', 'downloading')
    assert.equal(activity.snapshot('worker-9'), null)
  })
})

test('a waiting phase restores the previous one and marks the task as in flight', async () => {
  const activity = new WorkerActivity()
  await activity.run('worker-1', 'cat_c', async () => {
    assert.equal(activity.pacePriority(), 0)
    activity.set('preparing')
    await activity.during('waiting_turn', async () => {
      assert.equal(activity.snapshot('worker-1').phase, 'waiting_turn')
    })
    assert.equal(activity.snapshot('worker-1').phase, 'preparing')
    activity.markProviderAction()
    assert.equal(activity.pacePriority(), 1)
  })
  assert.equal(activity.pacePriority(), 0)
})

test('unknown phases are rejected so the UI never shows free text', async () => {
  const activity = new WorkerActivity()
  await activity.run('worker-1', 'cat_d', async () => {
    activity.set('reading the assistant prose')
    assert.equal(activity.snapshot('worker-1').phase, 'claimed')
  })
})

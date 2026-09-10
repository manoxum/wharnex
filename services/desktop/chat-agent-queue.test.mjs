import test from 'node:test'
import assert from 'node:assert/strict'
import { ChatAgentQueue, settleJob } from './chat-agent-queue.mjs'

function drain(queue, slotId = '') {
  const order = []
  for (let job = queue.take(slotId); job; job = queue.take(slotId)) order.push(job)
  return order
}

test('a write always outranks a read that was queued first', () => {
  const queue = new ChatAgentQueue()
  void queue.enqueue({ kind: 'read', chatId: 'c1' }).catch(() => undefined)
  void queue.enqueue({ kind: 'read', chatId: 'c2' }).catch(() => undefined)
  void queue.enqueue({ kind: 'write', chatId: 'c3' }).catch(() => undefined)
  assert.deepEqual(drain(queue).map((job) => `${job.kind}:${job.chatId}`), ['write:c3', 'read:c1', 'read:c2'])
})

// Account work mutates the user's account but nobody is blocked on it, so it
// sits between a waiting prompt and idle inspection.
test('account work sits between writes and reads', () => {
  const queue = new ChatAgentQueue()
  void queue.enqueue({ kind: 'read', chatId: 'r' }).catch(() => undefined)
  void queue.enqueue({ kind: 'account', chatId: 'a' }).catch(() => undefined)
  void queue.enqueue({ kind: 'write', chatId: 'w' }).catch(() => undefined)
  assert.deepEqual(drain(queue).map((job) => job.kind), ['write', 'account', 'read'])
})

test('equal priority preserves arrival order', () => {
  const queue = new ChatAgentQueue()
  for (const chatId of ['a', 'b', 'c']) void queue.enqueue({ kind: 'read', chatId }).catch(() => undefined)
  assert.deepEqual(drain(queue).map((job) => job.chatId), ['a', 'b', 'c'])
})

// Re-asking for an inspection that is already queued is one job, not two.
test('reads collapse on a dedupe key while writes never do', () => {
  const queue = new ChatAgentQueue()
  const first = queue.enqueue({ kind: 'read', chatId: 'c1', dedupeKey: 'inspect:c1' })
  const second = queue.enqueue({ kind: 'read', chatId: 'c1', dedupeKey: 'inspect:c1' })
  first.catch(() => undefined); second.catch(() => undefined)
  assert.equal(first, second)
  assert.equal(queue.depth, 1)

  void queue.enqueue({ kind: 'write', chatId: 'c1', dedupeKey: 'send:c1' }).catch(() => undefined)
  void queue.enqueue({ kind: 'write', chatId: 'c1', dedupeKey: 'send:c1' }).catch(() => undefined)
  assert.equal(queue.counts().write, 2)
})

test('an affine slot wins among equal-priority jobs without starving the others', () => {
  const queue = new ChatAgentQueue()
  void queue.enqueue({ kind: 'read', chatId: 'a' }).catch(() => undefined)
  void queue.enqueue({ kind: 'read', chatId: 'b', affinity: 'slot-2' }).catch(() => undefined)
  assert.equal(queue.take('slot-2').chatId, 'b')
  assert.equal(queue.take('slot-2').chatId, 'a')
})

test('affinity is a preference, so a slot with no affine job still gets work', () => {
  const queue = new ChatAgentQueue()
  void queue.enqueue({ kind: 'read', chatId: 'a', affinity: 'slot-1' }).catch(() => undefined)
  assert.equal(queue.take('slot-9').chatId, 'a')
})

test('an empty queue yields nothing and an unknown kind is refused', () => {
  const queue = new ChatAgentQueue()
  assert.equal(queue.take('slot-1'), undefined)
  assert.throws(() => queue.enqueue({ kind: 'delete-everything' }), /Unsupported chat-agent job kind/)
})

test('the queue refuses to grow without bound', () => {
  const queue = new ChatAgentQueue({ maxDepth: 2 })
  void queue.enqueue({ kind: 'read', chatId: 'a' }).catch(() => undefined)
  void queue.enqueue({ kind: 'read', chatId: 'b' }).catch(() => undefined)
  assert.throws(() => queue.enqueue({ kind: 'read', chatId: 'c' }), /queue is full/)
})

test('cancelling settles the waiting callers rather than leaving them pending', async () => {
  const queue = new ChatAgentQueue()
  const pending = queue.enqueue({ kind: 'read', chatId: 'a' })
  assert.equal(queue.cancelAll('stopped'), 1)
  await assert.rejects(pending, /stopped/)
})

// Superseding a chat's inspection must not cancel a prompt the user sent to it.
test('cancelling a chat drops its queued reads and keeps its writes', async () => {
  const queue = new ChatAgentQueue()
  const read = queue.enqueue({ kind: 'read', chatId: 'a' })
  const write = queue.enqueue({ kind: 'write', chatId: 'a' })
  write.catch(() => undefined)
  assert.equal(queue.cancelChat('a'), 1)
  await assert.rejects(read, /superseded/)
  assert.equal(queue.counts().write, 1)
})

test('a job settles exactly once', async () => {
  const queue = new ChatAgentQueue()
  const promise = queue.enqueue({ kind: 'write', chatId: 'a' })
  const job = queue.take()
  settleJob(job, undefined, { ok: true })
  settleJob(job, new Error('ignored second settle'))
  assert.deepEqual(await promise, { ok: true })
})

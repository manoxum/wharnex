import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTTransportPreparation, throwIfChatGPTTransportAborted } from './transport-preparation.mjs'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function preparationHarness() {
  const tails = new Map()
  const throttles = []
  const nonPreemptive = []
  let deferredNavigation = false
  const transport = createChatGPTTransportPreparation({
    tails,
    requireOwnedEntry: (key, entry) => {
      if (key !== entry.ownerKey) throw new Error('ChatGPT entry is not owned')
    },
    reconcileThrottle: (key, entry) => throttles.push([key, entry.transportPreparationCount]),
    residency: { setNonPreemptive: (slot, active) => nonPreemptive.push([slot, active]) },
    withTrace: (_id, operation) => operation(),
    traceId: () => 'trace',
    deferredNavigationPending: () => deferredNavigation,
    applyDeferredNavigation: () => {},
  })
  return { ...transport, tails, throttles, nonPreemptive, setDeferredNavigation: (value) => { deferredNavigation = value } }
}

test('a cancelled queued preparation never enters the ChatGPT operation and cleans up its slot', async () => {
  const harness = preparationHarness()
  const first = deferred()
  const entry = { ownerKey: 'chat_1', role: 'supervisor' }
  const active = harness.withChatGPTTransportPreparation('chat_1', entry, 'request_1', () => first.promise)
  const queued = harness.withChatGPTTransportPreparation('chat_1', entry, 'request_2', () => {
    throw new Error('cancelled operation ran')
  })
  assert.equal(harness.abortChatGPTTransportPreparations('chat_1', 'request_2'), 1)
  assert.equal(harness.abortChatGPTTransportPreparations('chat_2', 'request_2'), 0)
  first.resolve('completed')
  assert.equal(await active, 'completed')
  await assert.rejects(queued, (error) => error.code === 'WHARNEX_REQUEST_CANCELLED')
  assert.equal(entry.transportPreparationCount, 0)
  assert.equal(entry.transportRequestId, '')
  assert.equal(entry.transportAbortSignal, undefined)
  assert.equal(harness.tails.size, 0)
})

test('separate supervisors can prepare concurrently while one worker slot remains serial', async () => {
  const harness = preparationHarness()
  const gate = deferred()
  const first = { ownerKey: 'chat_1', role: 'supervisor' }
  const second = { ownerKey: 'chat_2', role: 'supervisor' }
  const running = harness.withChatGPTTransportPreparation('chat_1', first, 'one', () => gate.promise)
  assert.equal(await harness.withChatGPTTransportPreparation('chat_2', second, 'two', () => 'ready'), 'ready')
  assert.equal(first.transportPreparationCount, 1)
  gate.resolve()
  await running

  const workerGate = deferred()
  const workerOne = { ownerKey: 'chat_1', role: 'worker', slotId: 1 }
  const workerTwo = { ownerKey: 'chat_2', role: 'worker', slotId: 1 }
  const firstWorker = harness.withChatGPTTransportPreparation('chat_1', workerOne, 'one', () => workerGate.promise)
  let enteredSecond = false
  const secondWorker = harness.withChatGPTTransportPreparation('chat_2', workerTwo, 'two', () => { enteredSecond = true })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(enteredSecond, false)
  workerGate.resolve()
  await Promise.all([firstWorker, secondWorker])
  assert.equal(enteredSecond, true)
  assert.deepEqual(harness.nonPreemptive, [[1, true], [1, true], [1, false], [1, false]])
  assert.equal(harness.tails.size, 0)
})

test('active cancellation exposes AbortSignal to the operation and preserves cleanup', async () => {
  const harness = preparationHarness()
  const entry = { ownerKey: 'chat_1', role: 'supervisor' }
  const ready = deferred()
  const operation = harness.withChatGPTTransportPreparation('chat_1', entry, 'one', () => {
    ready.resolve()
    return new Promise((resolve, reject) => {
      entry.transportAbortSignal.addEventListener('abort', () => {
        try { throwIfChatGPTTransportAborted(entry.transportAbortSignal) } catch (error) { reject(error) }
      }, { once: true })
    })
  })
  await ready.promise
  assert.equal(harness.abortChatGPTTransportPreparations('chat_1', 'one'), 1)
  await assert.rejects(operation, (error) => error.name === 'AbortError')
  assert.deepEqual(harness.throttles, [['chat_1', 1], ['chat_1', 0]])
  assert.equal(harness.tails.size, 0)
  assert.equal(harness.abortChatGPTTransportPreparations('chat_1', 'one'), 0)
})

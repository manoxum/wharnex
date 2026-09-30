import test from 'node:test'
import assert from 'node:assert/strict'
import { OrchestrationTaskPins } from './chat-agent-orchestration-pins.mjs'

const execute = (id) => ({ type: 'ORCHESTRATOR_EXECUTE', chat_id: id })

test('a Worker stays pinned across WAITING attempts and releases when the task settles', () => {
  const pins = new OrchestrationTaskPins({ now: () => 0 })
  assert.equal(pins.note('worker-1', execute('otk_a'), { status: 'waiting' }), 'pinned')
  assert.equal(pins.lane('worker-1'), 'h:otk_a')
  assert.equal(pins.note('worker-1', execute('otk_a'), { status: 'error' }), 'pinned')
  assert.equal(pins.lane('worker-1'), 'h:otk_a')
  assert.deepEqual(pins.lanesHeldByOthers('worker-2'), ['h:otk_a'])
  for (const status of ['done', 'failed', 'attention']) {
    pins.note('worker-1', execute('otk_a'), { status: 'waiting' })
    assert.equal(pins.note('worker-1', execute('otk_a'), { status }), 'released')
    assert.equal(pins.lane('worker-1'), '')
  }
})

test('only Orchestrator executions pin, and one lane has one holder', () => {
  const pins = new OrchestrationTaskPins({ now: () => 0 })
  assert.equal(pins.note('worker-1', { type: 'ORGANIZE_CHAT', chat_id: 'chat' }, { status: 'waiting' }), '')
  pins.note('worker-1', execute('otk_a'), { status: 'waiting' })
  pins.note('worker-2', execute('otk_a'), { status: 'waiting' })
  assert.equal(pins.lane('worker-1'), '')
  assert.equal(pins.lane('worker-2'), 'h:otk_a')
})

test('a lane silent past the idle bound releases its Worker, and drained slots drop their pins', () => {
  let now = 0
  const pins = new OrchestrationTaskPins({ now: () => now, idleReleaseMs: 1_000 })
  pins.note('worker-1', execute('otk_a'), { status: 'waiting' })
  now = 999
  assert.equal(pins.noteIdle('worker-1'), false)
  now = 1_000
  assert.equal(pins.noteIdle('worker-1'), true)
  assert.equal(pins.lane('worker-1'), '')
  pins.note('worker-3', execute('otk_b'), { status: 'waiting' })
  pins.retain(['worker-1', 'worker-2'])
  assert.equal(pins.lane('worker-3'), '')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { ChatAgentResidency } from './index.mjs'

// Residency is an affinity cache. Without an expiry it behaved as ownership:
// a resident slot only claims its own lane, so it could never be rebound by
// claiming elsewhere, and every slot stayed pinned to a chat that had already
// been resolved while other conversations held due work.
test('a resident lane that produces no work is released back to the free pool', () => {
  let now = 1_000
  const residency = new ChatAgentResidency({ now: () => now, minResidenceMs: 30_000, idleReleaseMs: 20_000 })
  // A second free slot is what makes this the observed worst case: while any
  // slot is unresident no resident slot may cross lanes, so worker-1 stayed
  // locked to a finished conversation with no path back to the pool.
  residency.register('worker-2')
  const bind = residency.beginAssignment('worker-1', 'c:done')
  residency.settleAssignment('worker-1', bind.epoch, 'c:done', now)

  now += 60_000
  assert.equal(residency.claimOptions('worker-1').fallback_mode, 'resident_only')
  assert.equal(residency.noteIdleClaim('worker-1'), false, 'the first empty claim only starts the idle clock')

  now += 19_000
  assert.equal(residency.noteIdleClaim('worker-1'), false, 'still inside the idle window')

  now += 2_000
  assert.equal(residency.noteIdleClaim('worker-1'), true)
  assert.equal(residency.snapshot('worker-1').resident_lane, '')
  assert.equal(residency.claimOptions('worker-1').fallback_mode, 'unresident_only')
})

test('a trusted observation handoff releases a resident lane immediately without breaking non-preemptive work', () => {
  let now = 1_000
  const residency = new ChatAgentResidency({ now: () => now, minResidenceMs: 120_000 })
  const bind = residency.beginAssignment('worker-1', 'c:watched')
  residency.settleAssignment('worker-1', bind.epoch, bind.lane, now)

  assert.equal(residency.releaseResidentLane('worker-1', 'c:other'), false, 'a handoff may only release the exact resident lane')
  residency.setNonPreemptive('worker-1', true)
  assert.equal(residency.releaseResidentLane('worker-1', 'c:watched'), false, 'non-preemptive work is never interrupted')
  residency.setNonPreemptive('worker-1', false)

  assert.equal(residency.releaseResidentLane('worker-1', 'c:watched'), true)
  assert.equal(residency.snapshot('worker-1').resident_lane, '')
  assert.equal(residency.claimOptions('worker-1').fallback_mode, 'unresident_only')
  assert.equal(residency.epochCurrent('worker-1', bind.epoch), false, 'handoff invalidates stale assignment callbacks')
})

test('the dwell protects a freshly bound lane from idle release', () => {
  let now = 1_000
  const residency = new ChatAgentResidency({ now: () => now, minResidenceMs: 60_000, idleReleaseMs: 5_000 })
  const bind = residency.beginAssignment('worker-1', 'c:fresh')
  residency.settleAssignment('worker-1', bind.epoch, 'c:fresh', now)

  now += 30_000
  residency.noteIdleClaim('worker-1')
  now += 10_000
  // A conversation that was just written to is expected to be quiet while the
  // model starts; rebinding away would cost the navigation the dwell prevents.
  assert.equal(residency.noteIdleClaim('worker-1'), false)
  assert.equal(residency.snapshot('worker-1').resident_lane, 'c:fresh')

  now += 21_000
  assert.equal(residency.noteIdleClaim('worker-1'), true)
})

test('taking a task restarts the idle clock', () => {
  let now = 1_000
  const residency = new ChatAgentResidency({ now: () => now, minResidenceMs: 30_000, idleReleaseMs: 20_000 })
  const bind = residency.beginAssignment('worker-1', 'c:busy')
  residency.settleAssignment('worker-1', bind.epoch, 'c:busy', now)

  now += 60_000
  residency.noteIdleClaim('worker-1')
  now += 15_000
  residency.noteAssignment('worker-1')
  assert.equal(residency.snapshot('worker-1').idle_since, '')

  now += 15_000
  assert.equal(residency.noteIdleClaim('worker-1'), false, 'the clock restarted when the slot took a task')
  assert.equal(residency.snapshot('worker-1').resident_lane, 'c:busy')
})

// A blocked slot cannot serve its own lane, so reserving that lane against
// every other slot left the conversation claimable by nobody at all.
test('a blocked slot does not reserve its lane against the rest of the pool', () => {
  const now = 1_000
  const residency = new ChatAgentResidency({ now: () => now })
  for (const slot of ['worker-1', 'worker-2']) residency.register(slot)
  const bind = residency.beginAssignment('worker-1', 'c:held')
  residency.settleAssignment('worker-1', bind.epoch, 'c:held', now)

  assert.deepEqual(residency.claimOptions('worker-2').excluded_lanes, ['c:held'])

  // worker-1 enters interaction mode: it is no longer able to work its lane.
  assert.deepEqual(residency.claimOptions('worker-1', { blocked: true }), { skip: true })
  assert.deepEqual(residency.claimOptions('worker-2').excluded_lanes, [])
})

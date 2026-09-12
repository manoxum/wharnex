import assert from 'node:assert/strict'
import test from 'node:test'
import { CHAT_AGENT_AWAIT_PROBE_MS, CHAT_AGENT_NAVIGATION_GAP_MS, ChatAgentResidency, chatAgentLane } from './chat-agent-residency.mjs'

test('lane prefers durable conversation id and falls back to chat id', () => {
  assert.equal(chatAgentLane({ chat_id: 'chat-a', conversation_id: 'conv-a' }), 'c:conv-a')
  assert.equal(chatAgentLane({ chat_id: 'chat-a' }), 'h:chat-a')
})

test('free workers claim unresident lanes before any resident worker rotates', () => {
  let now = 1_000
  const residency = new ChatAgentResidency({ now: () => now })
  residency.register('worker-1')
  residency.register('worker-2')
  const bind = residency.beginAssignment('worker-1', 'c:a')
  residency.settleAssignment('worker-1', bind.epoch, 'c:a', now)
  now += 60_000
  assert.equal(residency.claimOptions('worker-1').fallback_mode, 'resident_only')
  assert.equal(residency.claimOptions('worker-2').fallback_mode, 'unresident_only')
})

test('rotation opens only for the head after the 60 second dwell', () => {
  let now = 10_000
  const residency = new ChatAgentResidency({ now: () => now })
  for (const [slot, lane] of [['worker-1', 'c:a'], ['worker-2', 'c:b']]) {
    const bind = residency.beginAssignment(slot, lane)
    residency.settleAssignment(slot, bind.epoch, lane, now)
  }
  assert.equal(residency.claimOptions('worker-1').fallback_mode, 'resident_only')
  now += 60_000
  assert.equal(residency.claimOptions('worker-1').fallback_mode, 'any')
  assert.equal(residency.claimOptions('worker-2').fallback_mode, 'resident_only')
  const rebind = residency.beginAssignment('worker-1', 'c:c')
  residency.settleAssignment('worker-1', rebind.epoch, 'c:c', now)
  assert.equal(residency.snapshot('worker-1').rotation_position, 1)
  assert.equal(residency.snapshot('worker-2').rotation_position, 0)
})

test('assignment epoch rejects stale callbacks and probes stay deliberately slow', () => {
  const residency = new ChatAgentResidency()
  const first = residency.beginAssignment('worker-1', 'c:a')
  residency.cancelAssignment('worker-1', first.epoch)
  const second = residency.beginAssignment('worker-1', 'c:b')
  assert.equal(residency.epochCurrent('worker-1', first.epoch), false)
  assert.equal(residency.epochCurrent('worker-1', second.epoch, 'c:b'), true)
  assert.equal(CHAT_AGENT_NAVIGATION_GAP_MS, 30_000)
  assert.equal(CHAT_AGENT_AWAIT_PROBE_MS, 30_000)
})

test('residency is deliberately ephemeral across desktop restart', () => {
  let now = 5_000
  const beforeRestart = new ChatAgentResidency({ now: () => now, minResidenceMs: 15_000 })
  const bind = beforeRestart.beginAssignment('worker-1', 'c:a')
  beforeRestart.settleAssignment('worker-1', bind.epoch, bind.lane, now)
  assert.equal(beforeRestart.snapshot('worker-1').resident_lane, 'c:a')
  assert.equal(new ChatAgentResidency({ now: () => now }).snapshot('worker-1').resident_lane, '')
})

test('residency dwell is configurable only inside the 30 to 120 second envelope', () => {
  let now = 1_000
  const short = new ChatAgentResidency({ now: () => now, minResidenceMs: 1 })
  const long = new ChatAgentResidency({ now: () => now, minResidenceMs: 90_000 })
  for (const [residency, slot] of [[short, 'short'], [long, 'long']]) {
    const bind = residency.beginAssignment(slot, `c:${slot}`)
    residency.settleAssignment(slot, bind.epoch, bind.lane, now)
  }
  assert.equal(Date.parse(short.snapshot('short').min_resident_until) - now, 30_000)
  assert.equal(Date.parse(long.snapshot('long').min_resident_until) - now, 90_000)
})

test('taking a task always sends the slot to the back of the rotation', () => {
  // The rotation decides which slot may cross lanes. Advancing it only on a
  // rebind left a slot serving its own resident lane permanently at the head,
  // so it stayed the only Worker allowed to escalate while the others waited.
  const residency = new ChatAgentResidency({ now: () => 1_000 })
  for (const slot of ['worker-1', 'worker-2', 'worker-3']) residency.register(slot)
  assert.equal(residency.snapshot('worker-1').rotation_position, 0)

  residency.noteAssignment('worker-1')
  assert.equal(residency.snapshot('worker-1').rotation_position, 2)
  assert.equal(residency.snapshot('worker-2').rotation_position, 0)

  residency.noteAssignment('worker-2')
  assert.equal(residency.snapshot('worker-2').rotation_position, 2)
  assert.equal(residency.snapshot('worker-3').rotation_position, 0)
})

test('a slot that keeps serving its resident lane still yields its rotation turn', () => {
  const residency = new ChatAgentResidency({ minResidenceMs: 30_000, now: () => 1_000 })
  for (const slot of ['worker-1', 'worker-2']) residency.register(slot)
  const first = residency.beginAssignment('worker-1', 'c:conv-a')
  residency.settleAssignment('worker-1', first.epoch, 'c:conv-a')
  assert.equal(residency.snapshot('worker-1').rotation_position, 1)

  // Re-serving the same lane is not a rebind, so settleAssignment is never
  // reached; the assignment itself has to move the slot.
  const again = residency.beginAssignment('worker-1', 'c:conv-a')
  assert.equal(again.rebind, false)
  residency.noteAssignment('worker-1')
  assert.equal(residency.snapshot('worker-1').rotation_position, 1)
  assert.equal(residency.snapshot('worker-2').rotation_position, 0)
})

test('a live resident supervision cannot rotate into an excess generating lane', () => {
  let now = 1_000
  const residency = new ChatAgentResidency({ minResidenceMs: 30_000, now: () => now })
  for (const slot of ['worker-1', 'worker-2']) residency.register(slot)
  for (const [slot, lane] of [['worker-1', 'c:live-a'], ['worker-2', 'c:live-b']]) {
    const assignment = residency.beginAssignment(slot, lane)
    residency.settleAssignment(slot, assignment.epoch, lane, now)
  }

  now += 60_000
  const options = residency.claimOptions('worker-1', { pinResident: true })
  assert.equal(options.preferred_lane, 'c:live-a')
  assert.equal(options.fallback_mode, 'resident_only')
  assert.deepEqual(options.excluded_lanes, ['c:live-b'])
})

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

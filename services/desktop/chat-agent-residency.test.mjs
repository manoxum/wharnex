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

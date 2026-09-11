import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_TOTAL_SLOTS,
  DEFAULT_WORKER_SLOTS,
  HARD_MAX_WORKER_SLOTS,
  MIN_WORKER_SLOTS,
  assignRoles,
  canonicalConversationID,
  canonicalConversationURL,
  desiredSlotCount,
  normalizeWorkerSlotCount,
  selectSlotForJob,
  slotBlueprints,
} from './chat-agent-pool.mjs'

test('one active profile uses two supervisors plus six workers by default', () => {
  assert.equal(desiredSlotCount(0), 0)
  assert.equal(desiredSlotCount(1), 8)
  assert.equal(desiredSlotCount(30), 8)
  assert.equal(DEFAULT_WORKER_SLOTS, 6)
  assert.equal(DEFAULT_TOTAL_SLOTS, 8)
  assert.deepEqual(slotBlueprints().map((slot) => slot.role), ['supervisor', 'supervisor', 'worker', 'worker', 'worker', 'worker', 'worker', 'worker'])
})

test('assignRoles preserves two exclusive supervisors', () => {
  const roles = assignRoles([
    { id: 'worker-1' },
    { id: 'supervisor-1', role: 'supervisor' },
    { id: 'supervisor-2', role: 'supervisor' },
    { id: 'worker-2' },
  ])
  assert.equal(roles.filter((slot) => slot.role === 'supervisor').length, 2)
  assert.equal(roles.find((slot) => slot.id === 'supervisor-1').role, 'supervisor')
  assert.equal(roles.find((slot) => slot.id === 'supervisor-2').role, 'supervisor')
})

test('background jobs can never fall back to the supervisor', () => {
  const slots = [
    { id: 'supervisor-1', role: 'supervisor', busy: false, chatId: 'visible' },
    { id: 'supervisor-2', role: 'supervisor', busy: false },
    { id: 'worker-1', role: 'worker', busy: true },
    { id: 'worker-2', role: 'worker', busy: true },
    { id: 'worker-3', role: 'worker', busy: true },
  ]
  assert.equal(selectSlotForJob(slots, { type: 'BOT_WRITE', chatId: 'visible' }), undefined)
  assert.equal(selectSlotForJob(slots, { type: 'AWAIT_RESPONSE', chatId: 'visible' }), undefined)
})

test('worker affinity is preference only', () => {
  const slots = [
    { id: 'supervisor-1', role: 'supervisor', busy: false },
    { id: 'supervisor-2', role: 'supervisor', busy: false },
    { id: 'worker-1', role: 'worker', busy: false, conversationId: 'conv-a' },
    { id: 'worker-2', role: 'worker', busy: false, conversationId: 'conv-b' },
    { id: 'worker-3', role: 'worker', busy: false },
  ]
  assert.equal(selectSlotForJob(slots, { conversationId: 'conv-b' }).id, 'worker-2')
  slots[3].busy = true
  assert.equal(selectSlotForJob(slots, { conversationId: 'conv-b' }).id, 'worker-1')
})

test('conversation identity survives project URL changes', () => {
  const id = 'abc-123'
  assert.equal(canonicalConversationID(`https://chatgpt.com/c/${id}`), id)
  assert.equal(canonicalConversationID(`https://chatgpt.com/g/g-p-project/c/${id}?x=1`), id)
  assert.equal(canonicalConversationURL(`https://chatgpt.com/g/g-p-project/c/${id}`), `https://chatgpt.com/c/${id}`)
  assert.equal(canonicalConversationID('https://chatgpt.com/c/WEB:temp'), '')
})


test('worker topology clamps operator scaling to the supported bounds', () => {
  assert.equal(normalizeWorkerSlotCount(0), MIN_WORKER_SLOTS)
  assert.equal(normalizeWorkerSlotCount(1), 1)
  assert.equal(normalizeWorkerSlotCount(4), 4)
  assert.equal(normalizeWorkerSlotCount(99), HARD_MAX_WORKER_SLOTS)
  assert.equal(desiredSlotCount(1, 1), 3)
  assert.equal(desiredSlotCount(1, 6), 8)
  assert.deepEqual(slotBlueprints(2).map((slot) => slot.id), ['supervisor-1', 'supervisor-2', 'worker-1', 'worker-2'])
})

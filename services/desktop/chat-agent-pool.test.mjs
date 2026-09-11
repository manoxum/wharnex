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

test('one active profile uses one supervisor plus three workers', () => {
  assert.equal(desiredSlotCount(0), 0)
  assert.equal(desiredSlotCount(1), 4)
  assert.equal(desiredSlotCount(30), 4)
  assert.equal(DEFAULT_WORKER_SLOTS, 3)
  assert.equal(DEFAULT_TOTAL_SLOTS, 4)
  assert.deepEqual(slotBlueprints().map((slot) => slot.role), ['supervisor', 'worker', 'worker', 'worker'])
})

test('assignRoles preserves a single exclusive supervisor', () => {
  const roles = assignRoles([
    { id: 'worker-1' },
    { id: 'supervisor', role: 'supervisor' },
    { id: 'worker-2' },
    { id: 'worker-3' },
  ])
  assert.equal(roles.filter((slot) => slot.role === 'supervisor').length, 1)
  assert.equal(roles.find((slot) => slot.id === 'supervisor').role, 'supervisor')
})

test('background jobs can never fall back to the supervisor', () => {
  const slots = [
    { id: 'supervisor', role: 'supervisor', busy: false, chatId: 'visible' },
    { id: 'worker-1', role: 'worker', busy: true },
    { id: 'worker-2', role: 'worker', busy: true },
    { id: 'worker-3', role: 'worker', busy: true },
  ]
  assert.equal(selectSlotForJob(slots, { type: 'BOT_WRITE', chatId: 'visible' }), undefined)
  assert.equal(selectSlotForJob(slots, { type: 'AWAIT_RESPONSE', chatId: 'visible' }), undefined)
})

test('worker affinity is preference only', () => {
  const slots = [
    { id: 'supervisor', role: 'supervisor', busy: false },
    { id: 'worker-1', role: 'worker', busy: false, conversationId: 'conv-a' },
    { id: 'worker-2', role: 'worker', busy: false, conversationId: 'conv-b' },
    { id: 'worker-3', role: 'worker', busy: false },
  ]
  assert.equal(selectSlotForJob(slots, { conversationId: 'conv-b' }).id, 'worker-2')
  slots[2].busy = true
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
  assert.equal(desiredSlotCount(1, 1), 2)
  assert.equal(desiredSlotCount(1, 6), 7)
  assert.deepEqual(slotBlueprints(2).map((slot) => slot.id), ['supervisor', 'worker-1', 'worker-2'])
})

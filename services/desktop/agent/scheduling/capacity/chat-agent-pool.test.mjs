import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SUPERVISOR_SLOTS,
  DEFAULT_WORKER_SLOTS,
  HARD_MAX_SUPERVISOR_SLOTS,
  HARD_MAX_WORKER_SLOTS,
  MIN_SUPERVISOR_SLOTS,
  MIN_WORKER_SLOTS,
  SUPERVISOR_TASK_TYPES,
  assignRoles,
  canonicalConversationID,
  canonicalConversationURL,
  desiredSlotCount,
  isSupervisorTaskType,
  normalizeSupervisorSlotCount,
  normalizeWorkerSlotCount,
  selectSlotForJob,
  selectSupervisorForRebind,
  slotBlueprints,
} from './chat-agent-pool.mjs'

test('one active profile uses three chat-bound supervisors plus two workers by default', () => {
  assert.equal(desiredSlotCount(0), 0)
  assert.equal(desiredSlotCount(1), 5)
  assert.equal(desiredSlotCount(30), 5)
  assert.equal(DEFAULT_SUPERVISOR_SLOTS, 3)
  assert.equal(DEFAULT_WORKER_SLOTS, 2)
  assert.deepEqual(slotBlueprints().map((slot) => slot.role), [
    'supervisor', 'supervisor', 'supervisor',
    'worker', 'worker',
  ])
})

test('assignRoles preserves three exclusive supervisors by default', () => {
  const roles = assignRoles([
    { id: 'worker-1' },
    ...Array.from({ length: DEFAULT_SUPERVISOR_SLOTS }, (_, index) => ({ id: `supervisor-${index + 1}`, role: 'supervisor' })),
    { id: 'worker-2' },
  ])
  assert.equal(roles.filter((slot) => slot.role === 'supervisor').length, DEFAULT_SUPERVISOR_SLOTS)
  for (let index = 1; index <= DEFAULT_SUPERVISOR_SLOTS; index += 1) {
    assert.equal(roles.find((slot) => slot.id === `supervisor-${index}`).role, 'supervisor')
  }
  assert.equal(roles.find((slot) => slot.id === 'worker-1').role, 'worker')
})

test('supervisors own the chat-bound request lifecycle and nothing smaller', () => {
  assert.deepEqual([...SUPERVISOR_TASK_TYPES], ['AWAIT_RESPONSE', 'BOT_WRITE', 'RECOVERY_WRITE'])
  for (const type of SUPERVISOR_TASK_TYPES) assert.equal(isSupervisorTaskType(type), true)
  for (const type of ['RENAME_CHAT', 'ORGANIZE_CHAT', 'ARCHIVE_CHAT', 'DELETE_CHAT', 'DELETE_TEMP_CHAT', 'DELETE_BUNDLE', 'TITLE_DISCOVER', 'TITLE_GENERATE_TEMP', 'TITLE_AWAIT', 'TRANSLATE_MARKDOWN', 'RELEASE_NOTES', 'ORCHESTRATOR_PLAN', 'TODO_CLASSIFY']) {
    assert.equal(isSupervisorTaskType(type), false)
  }
  assert.equal(isSupervisorTaskType(''), false)
})

test('a supervisor releases its chat only when it holds nothing and another chat is waiting', () => {
  const slots = [
    { id: 'supervisor-1', held: true, lastUsed: 1 },
    { id: 'supervisor-2', held: true, lastUsed: 2 },
  ]
  assert.equal(selectSupervisorForRebind(slots), undefined, 'a request in progress is never interrupted for a waiting chat')
  slots.push({ id: 'supervisor-3', held: false, lastUsed: 9, active: true })
  slots.push({ id: 'supervisor-4', held: false, lastUsed: 7 })
  assert.equal(selectSupervisorForRebind(slots).id, 'supervisor-4', 'the least recently used free slot yields before the visible one')
  assert.equal(selectSupervisorForRebind([{ id: 'supervisor-5', held: false, destroyed: true }]), undefined)
})

test('Worker-pool selection can never fall back to the supervisor', () => {
  const slots = [
    { id: 'supervisor-1', role: 'supervisor', busy: false, chatId: 'visible' },
    { id: 'supervisor-2', role: 'supervisor', busy: false },
    { id: 'worker-1', role: 'worker', busy: true },
    { id: 'worker-2', role: 'worker', busy: true },
    { id: 'worker-3', role: 'worker', busy: true },
  ]
  assert.equal(selectSlotForJob(slots, { type: 'RENAME_CHAT', chatId: 'visible' }), undefined)
  assert.equal(selectSlotForJob(slots, { type: 'TRANSLATE_MARKDOWN', chatId: 'visible' }), undefined)
  assert.equal(selectSlotForJob(slots, { type: 'TODO_CLASSIFY', chatId: 'todo-1' }), undefined)
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
  slots.find((slot) => slot.id === 'worker-2').busy = true
  assert.equal(selectSlotForJob(slots, { conversationId: 'conv-b' }).id, 'worker-1')
})

test('conversation identity survives project URL changes', () => {
  const id = 'abc-123'
  assert.equal(canonicalConversationID(`https://chatgpt.com/c/${id}`), id)
  assert.equal(canonicalConversationID(`https://chatgpt.com/g/g-p-project/c/${id}?x=1`), id)
  assert.equal(canonicalConversationURL(`https://chatgpt.com/g/g-p-project/c/${id}`), `https://chatgpt.com/c/${id}`)
  assert.equal(canonicalConversationID('https://chatgpt.com/c/WEB:temp'), '')
})


test('worker and supervisor topology clamps operator scaling to the supported bounds', () => {
  assert.equal(normalizeWorkerSlotCount(0), MIN_WORKER_SLOTS)
  assert.equal(normalizeWorkerSlotCount(1), 1)
  assert.equal(normalizeWorkerSlotCount(2), 2)
  assert.equal(HARD_MAX_WORKER_SLOTS, 6)
  assert.equal(normalizeWorkerSlotCount(99), HARD_MAX_WORKER_SLOTS)
  assert.equal(normalizeSupervisorSlotCount(0), MIN_SUPERVISOR_SLOTS)
  assert.equal(normalizeSupervisorSlotCount(3), 3)
  assert.equal(HARD_MAX_SUPERVISOR_SLOTS, 12)
  assert.equal(normalizeSupervisorSlotCount(99), HARD_MAX_SUPERVISOR_SLOTS)
  assert.equal(desiredSlotCount(1, 3, 1), 4)
  assert.equal(desiredSlotCount(1, 3, 6), 9)
  assert.deepEqual(slotBlueprints(2, 2).map((slot) => slot.id), [
    'supervisor-1', 'supervisor-2',
    'worker-1', 'worker-2',
  ])
})

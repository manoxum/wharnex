import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_MAX_SLOTS, HARD_MAX_SLOTS, assignRoles, desiredSlotCount, selectSlotForEviction, selectSlotForJob } from './chat-agent-pool.mjs'

const slot = (id, overrides = {}) => ({ id, chatId: '', role: 'worker', busy: false, destroyed: false, lastUsed: 0, ...overrides })

test('a single chat holds the pool at exactly one slot', () => {
  assert.equal(desiredSlotCount(0), 1)
  assert.equal(desiredSlotCount(1), 1)
})

// The viewing slot must never be the slot doing background inspection, so the
// moment a second chat exists the pool needs a second instance.
test('more than one chat raises the floor to two slots', () => {
  assert.equal(desiredSlotCount(2), 2)
  assert.equal(desiredSlotCount(3), 3)
})

test('the pool grows to its ceiling and never beyond it', () => {
  assert.equal(desiredSlotCount(30), DEFAULT_MAX_SLOTS)
  assert.equal(desiredSlotCount(30, 5), 5)
  assert.equal(desiredSlotCount(30, 99), HARD_MAX_SLOTS)
})

// A fourth slot with three chats would idle forever.
test('the pool never holds more slots than there are chats', () => {
  assert.equal(desiredSlotCount(2, 5), 2)
})

test('exactly one slot carries the view role whenever several exist', () => {
  const roles = assignRoles([slot('a'), slot('b'), slot('c')], 'chat-1')
  assert.equal(roles.filter((entry) => entry.role === 'view').length, 1)
  assert.equal(roles.filter((entry) => entry.role === 'worker').length, 2)
})

test('the slot already showing the active chat keeps the view role', () => {
  const roles = assignRoles([slot('a'), slot('b', { chatId: 'chat-1' })], 'chat-1')
  assert.equal(roles.find((entry) => entry.role === 'view').id, 'b')
})

test('a lone slot is the view slot and destroyed slots are ignored', () => {
  assert.deepEqual(assignRoles([slot('a')], 'chat-1').map((entry) => entry.role), ['view'])
  assert.deepEqual(assignRoles([slot('a', { destroyed: true }), slot('b')], 'chat-1').map((entry) => entry.id), ['b'])
})

test('work for the visible chat runs on the visible slot', () => {
  const slots = [slot('view', { chatId: 'chat-1' }), slot('worker')]
  const chosen = selectSlotForJob(slots, { kind: 'write', chatId: 'chat-1' }, 'chat-1')
  assert.equal(chosen.id, 'view')
})

// A background read on the viewing slot would navigate the page out from under
// the person reading it.
test('a background read never takes the viewing slot', () => {
  const slots = [slot('view', { chatId: 'chat-1' }), slot('worker', { busy: true })]
  assert.equal(selectSlotForJob(slots, { kind: 'read', chatId: 'chat-9' }, 'chat-1'), undefined)
})

// A user waiting on their own prompt outranks protecting the view.
test('a write may fall back to the viewing slot when no worker is free', () => {
  const slots = [slot('view', { chatId: 'chat-1' }), slot('worker', { busy: true })]
  assert.equal(selectSlotForJob(slots, { kind: 'write', chatId: 'chat-9' }, 'chat-1').id, 'view')
})

test('a worker already parked on the target conversation is preferred', () => {
  const slots = [slot('view', { chatId: 'chat-1' }), slot('w1'), slot('w2', { chatId: 'chat-7' })]
  assert.equal(selectSlotForJob(slots, { kind: 'read', chatId: 'chat-7' }, 'chat-1').id, 'w2')
})

test('nothing is dispatched when every slot is busy', () => {
  const slots = [slot('view', { busy: true }), slot('worker', { busy: true })]
  assert.equal(selectSlotForJob(slots, { kind: 'write', chatId: 'chat-1' }, 'chat-1'), undefined)
})

test('eviction spares the viewing slot and busy slots, then takes the least recently used', () => {
  const slots = [slot('view', { chatId: 'chat-1', lastUsed: 1 }), slot('busy', { busy: true, lastUsed: 2 }), slot('old', { lastUsed: 3 }), slot('older', { lastUsed: 2 })]
  assert.equal(selectSlotForEviction(slots, 'chat-1').id, 'older')
  assert.equal(selectSlotForEviction([slot('only', { chatId: 'chat-1' })], 'chat-1'), undefined)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { completionNotificationRecord } from './desktop-notification-request.mjs'

test('a completion notification is bounded and keeps its project attribution', () => {
  const record = completionNotificationRecord('/work/alpha', {
    id: ' n1 ', chatId: ' chat ', kind: 'task-completed', title: 'x'.repeat(400), body: 'y'.repeat(900), occurredAt: '2026-09-22T10:00:00.000Z',
  })
  assert.equal(record.id, 'n1')
  assert.equal(record.chatId, 'chat')
  assert.equal(record.projectPath, '/work/alpha')
  assert.equal(record.title.length, 160)
  assert.equal(record.body.length, 600)
  assert.equal(record.occurredAt, '2026-09-22T10:00:00.000Z')
})

test('the kind comes from a closed set and the title falls back per kind', () => {
  assert.equal(completionNotificationRecord('/work/alpha', { id: 'n1', chatId: 'chat', kind: 'restart-pending' }).title, 'Auto-evolução concluída')
  assert.equal(completionNotificationRecord('/work/alpha', { id: 'n1', chatId: 'chat', kind: 'task-completed' }).title, 'Tarefa concluída')
  assert.throws(() => completionNotificationRecord('/work/alpha', { id: 'n1', chatId: 'chat', kind: 'anything-else' }), /Invalid completion notification/)
  assert.throws(() => completionNotificationRecord('/work/alpha', { chatId: 'chat', kind: 'task-completed' }), /Invalid completion notification/)
  assert.throws(() => completionNotificationRecord('/work/alpha', { id: 'n1', kind: 'task-completed' }), /Invalid completion notification/)
})

test('an absent timestamp is stamped rather than left empty', () => {
  const record = completionNotificationRecord('/work/alpha', { id: 'n1', chatId: 'chat', kind: 'task-completed' })
  assert.ok(!Number.isNaN(Date.parse(record.occurredAt)))
})

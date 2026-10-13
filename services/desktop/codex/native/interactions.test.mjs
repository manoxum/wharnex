import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeInteractions } from './interactions.mjs'

function fixture() {
  const record = { threadId: 'thread', turnId: 'turn', status: 'running', pendingAsks: [] }
  const interactions = createNativeInteractions({ find: (id) => id === 'thread' ? record : null, save: async () => {}, publish() {}, journal: { append: async () => {}, protectSecret() {} } })
  const params = { threadId: 'thread', turnId: 'turn', itemId: 'item', questions: [{ id: 'question', header: 'Next', question: 'Continue?' }] }
  return { record, interactions, params }
}
test('server resolution retires only the exact pending request', async () => {
  const { record, interactions, params } = fixture()
  const first = interactions.request({ id: 1, method: 'item/tool/requestUserInput', params })
  const firstRejected = assert.rejects(first, /encerrada/)
  const second = interactions.request({ id: '2', method: 'item/tool/requestUserInput', params })
  await new Promise((resolve) => setImmediate(resolve))
  const remaining = record.pendingAsks[1].id
  interactions.retire(record, 1); await firstRejected
  assert.equal(record.status, 'waiting'); assert.deepEqual(record.pendingAsks.map((item) => item.id), [remaining])
  await interactions.answer(record, remaining, { answers: { question: { answers: ['Continue'] } } })
  assert.deepEqual(await second, { answers: { question: { answers: ['Continue'] } } })
})
test('approval cannot widen native permissions or silently accept session-wide authority', async () => {
  const { record, interactions, params } = fixture()
  const requested = { fileSystem: { write: ['/selected'] } }
  const reply = interactions.request({ id: 3, method: 'item/permissions/requestApproval', params: { ...params, permissions: requested } })
  await new Promise((resolve) => setImmediate(resolve))
  const ask = record.pendingAsks[0]
  await assert.rejects(interactions.answer(record, ask.id, { decision: 'acceptForSession' }), /inválida/)
  await interactions.answer(record, ask.id, { decision: 'accept', permissions: { write: ['/'] }, scope: 'session' })
  assert.deepEqual(await reply, { permissions: requested, scope: 'turn' })
  await assert.rejects(interactions.request({ id: 4, method: 'generic/execute', params }), /sem proprietário/)
})

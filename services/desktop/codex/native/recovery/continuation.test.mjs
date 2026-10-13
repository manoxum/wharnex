import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeContinuation } from '../continuation.mjs'

test('manual continuation scopes ownership, refuses live work and never replays the original prompt', async () => {
  const record = { requestId: 'req_original', sessionId: 'session', threadId: 'thread', turnId: 'turn', accountId: 'first', resumeAvailable: true, status: 'attention', title: 'Work', permissionLevel: 'auto', effort: 'xhigh', model: 'model' }
  const calls = [], prepared = []
  const rpc = { ready: async () => {}, call: async (method) => { calls.push(method); return { thread: { status: { type: 'notLoaded' }, turns: [] } } } }
  const resume = createNativeContinuation({ owned: async (project, chat) => { assert.equal(project, '/project'); assert.equal(chat, 'chat'); return record }, accounts: { runtime: async (id) => { assert.equal(id, 'first'); return rpc }, selected: async () => 'second' }, save: async () => {}, publish() {}, interactions: { retire() {} }, journal: { append: async () => {} }, prepare: async (request) => prepared.push(request) })
  await assert.rejects(resume('/project', 'chat', 'req_wrong', 'Continue.', false), /disponível/)
  record.status = 'running'; await assert.rejects(resume('/project', 'chat', record.requestId, 'Continue.', false), /disponível/)
  record.status = 'attention'
  await resume('/project', 'chat', record.requestId, 'Reviewed continuation.', true)
  assert.deepEqual(calls, ['thread/read', 'thread/resume'])
  assert.equal(prepared[0].text, 'Reviewed continuation.'); assert.notEqual(prepared[0].requestId, record.requestId)
  assert.equal(prepared[0].permissionLevel, 'auto'); assert.equal(prepared[0].selfEvolution, true); assert.deepEqual(prepared[0].attachments, [])
})

test('a refused writer leaves the request retryable and play uses native continuation instructions', async () => {
  const record = { requestId: 'req_original', sessionId: 'session', threadId: 'thread', accountId: 'default', resumeAvailable: true, status: 'attention', permissionLevel: 'ask' }
  let blocked = true
  const prepared = [], mutations = []
  const rpc = { ready: async () => {}, call: async (method, params) => {
    if (method === 'thread/resume') {
      assert.equal(params.excludeTurns, true)
      assert.equal(params.approvalPolicy, 'on-request')
      if (blocked) throw Object.assign(new Error('Writer busy.'), { reason: 'threadWriterBusy' })
    }
    return { thread: { status: { type: 'notLoaded' } } }
  } }
  const resume = createNativeContinuation({ owned: async () => record, accounts: { runtime: async () => rpc, selected: async () => 'default' },
    save: async () => mutations.push('save'), publish() {}, interactions: { retire() { mutations.push('retire') } },
    journal: { append: async (_record, type, body) => mutations.push({ type, body }) }, prepare: async (request) => prepared.push(request) })
  await assert.rejects(resume('/project', 'chat', 'req_original', undefined, false), { reason: 'threadWriterBusy' })
  assert.equal(record.requestId, 'req_original'); assert.equal(record.status, 'attention')
  assert.deepEqual(mutations, [{ type: 'request/continuation-failed', body: { reason: 'threadWriterBusy', code: 0 } }]); assert.deepEqual(prepared, [])
  blocked = false
  await resume('/project', 'chat', 'req_original', undefined, false)
  assert.match(prepared[0].text, /Continue o pedido anterior/)
  assert.deepEqual(prepared[0].attachments, []); assert.deepEqual(prepared[0].projectFiles, [])
})

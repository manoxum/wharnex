import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createNativeSteering } from './index.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-steer-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const record = { projectPath: '/project', chatId: 'chat', requestId: 'req_main', threadId: 'thread', turnId: 'turn', accountId: 'original', status: 'running', messages: [] }
  const calls = [], ledger = []
  let fail = false, gate = Promise.resolve()
  const steering = createNativeSteering({ root, owned: async (project, chat) => { if (project !== record.projectPath || chat !== record.chatId) throw new Error('ownership'); return record },
    accounts: { runtime: async (accountId) => { assert.equal(accountId, 'original'); return { ready: async () => {}, call: async (method, params) => { calls.push({ method, params }); await gate; if (fail) throw new Error('disconnected'); return { turnId: 'turn' } } } } },
    save: async () => {}, publish() {}, journal: { append: async (_record, method) => ledger.push(method) } })
  return { record, calls, ledger, ...steering, fail: () => { fail = true }, pause: () => { let release; gate = new Promise((resolve) => { release = resolve }); return release } }
}
test('guidance is scoped to the owned active request and original account, with duplicate suppression', async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.steer('/other', 'chat', 'req_main', 'one', 'text'), /ownership/)
  await assert.rejects(f.steer('/project', 'other', 'req_main', 'one', 'text'), /ownership/)
  await assert.rejects(f.steer('/project', 'chat', 'req_stale', 'one', 'text'), /ativo/)
  await Promise.all([f.steer('/project', 'chat', 'req_main', 'one', 'text'), f.steer('/project', 'chat', 'req_main', 'one', 'text')])
  await f.steer('/project', 'chat', 'req_main', 'one', 'text')
  assert.equal(f.calls.length, 1)
  assert.equal(f.record.messages.length, 1)
  f.record.status = 'completed'
  await assert.rejects(f.steer('/project', 'chat', 'req_main', 'two', 'text'), /ativo/)
})
test('uncertain delivery is recorded, surfaced and never automatically replayed', async (t) => {
  const f = await fixture(t); f.fail()
  await assert.rejects(f.steer('/project', 'chat', 'req_main', 'one', 'text'), /não confirmou/)
  await assert.rejects(f.steer('/project', 'chat', 'req_main', 'one', 'text'), /não foi confirmado/)
  assert.equal(f.calls.length, 1); assert.equal(f.record.messages.length, 0)
  assert.deepEqual(f.ledger, ['request/steer-requested', 'request/steer-failed'])
})
test('completion waits for accepted guidance and its attachments before archiving', async (t) => {
  const f = await fixture(t), release = f.pause()
  const operation = f.steer('/project', 'chat', 'req_main', 'one', 'Use the attached note.', [{ name: 'note.txt', mime: 'text/plain', contentBase64: Buffer.from('selected note').toString('base64') }])
  while (!f.calls.length) await new Promise((resolve) => setTimeout(resolve, 1))
  let finished = false
  const flushing = f.flush(f.record).then(() => { finished = true })
  await Promise.resolve(); assert.equal(finished, false)
  release(); await operation; await flushing
  assert.equal(await readFile(f.record.attachments[0].path, 'utf8'), 'selected note')
  assert.equal(f.record.messages.at(-1).text, 'Use the attached note.')
})
test('a late acknowledgment cannot attach the old guidance to a resumed request', async (t) => {
  const f = await fixture(t), release = f.pause()
  const operation = f.steer('/project', 'chat', 'req_main', 'one', 'old guidance')
  while (!f.calls.length) await new Promise((resolve) => setTimeout(resolve, 1))
  f.record.requestId = 'req_resumed'; f.record.turnId = 'new-turn'; f.record.accountId = 'new-account'
  release()
  await assert.rejects(operation, /não confirmou/)
  assert.equal(f.record.messages.length, 0)
  assert.equal(f.calls[0].params.expectedTurnId, 'turn')
})

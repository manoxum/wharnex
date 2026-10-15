import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createNativeCodexEngine } from '../engine.mjs'

test('an incremental prompt reaches the active native turn immediately without a new turn or scraper queue', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-steer-'))
  const calls = []
  const engine = createNativeCodexEngine({ root, publish() {}, rpcFactory: () => ({
    ready: async () => {}, stop: async () => {}, call: async (method, params) => {
      calls.push({ method, params })
      if (method === 'thread/start') return { thread: { id: 'thread' } }
      return { turn: { id: 'turn' }, turnId: 'turn' }
    },
  }) })
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }) })
  await engine.prepare({ projectPath: '/project', cacheKey: 'chat', sessionId: 'session', requestId: 'req_active_12345678', text: 'Work', attachments: [], projectFiles: [] })
  await engine.steer('/project', 'chat', 'req_active_12345678', 'increment-1', 'Inclua também o teste.', [])
  assert.equal(calls.filter((call) => call.method === 'turn/start').length, 1)
  const steer = calls.find((call) => call.method === 'turn/steer')
  assert.deepEqual(steer.params, { threadId: 'thread', expectedTurnId: 'turn', input: [{ type: 'text', text: 'Inclua também o teste.' }] })
  const record = await engine.owned('/project', 'chat')
  assert.equal(record.requestId, 'req_active_12345678')
  assert.match(record.messages.at(-1).text, /Inclua também o teste/)
  assert.match(await readFile(path.join(root, 'history', 'req_active_12345678.jsonl'), 'utf8'), /request\/steered/)
})

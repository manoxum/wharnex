import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createNativeCodexEngine } from '../engine.mjs'

test('an already saved native usage-limit failure exposes and accepts manual continuation', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-native-quota-recovery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const record = { native: true, projectPath: '/project', chatId: 'chat', sessionId: 'session', requestId: 'req_native_interrupted', threadId: 'thread',
    status: 'attention', error: "You've hit your usage limit. Try again later.", model: 'model', messages: [{ id: 'original', role: 'user', text: 'Finish the pending work.' }], activities: [{ id: 'command', type: 'commandExecution', command: 'npm test' }] }
  await mkdir(root, { recursive: true }); await writeFile(path.join(root, 'bindings.json'), JSON.stringify([record]))
  const calls = []
  const engine = createNativeCodexEngine({ root, publish() {}, rpcFactory: () => ({ ready: async () => {}, stop: async () => {}, call: async (method, params) => {
    calls.push({ method, params })
    if (method === 'thread/read') return { thread: { status: { type: 'notLoaded' }, turns: [] } }
    if (method === 'thread/resume') return { thread: { id: 'thread' }, model: 'model' }
    if (method === 'turn/start') return { turn: { id: 'next-turn' } }
    return {}
  } }) })
  const restored = (await engine.list('/project'))[0]
  assert.equal(restored.resumeAvailable, true)
  assert.equal(restored.pauseReason, 'quota')
  assert.equal(JSON.parse(await readFile(path.join(root, 'bindings.json'), 'utf8'))[0].resumeAvailable, true)
  assert.deepEqual(calls, [])
  await engine.resume('/project', 'chat', record.requestId, 'Continue from the current files.', false)
  assert.equal(calls.find((call) => call.method === 'thread/resume').params.threadId, 'thread')
  assert.equal(calls.find((call) => call.method === 'turn/start').params.input[0].text, 'Continue from the current files.')
})

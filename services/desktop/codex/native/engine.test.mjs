import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createNativeCodexEngine } from './engine.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-native-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = [], archived = []; let handlers
  const rpc = { ready: async () => {}, stop: async () => {}, call: async (method, params) => {
    calls.push({ method, params })
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'native-thread' }, model: 'native-model' }
    if (method === 'turn/start') return { turn: { id: 'native-turn' } }
    return {}
  } }
  const engine = createNativeCodexEngine({ root, publish() {}, archive: async (_record, artifact) => archived.push(artifact), rpcFactory: (options) => { handlers = options; return rpc } })
  const request = { projectPath: '/project', cacheKey: 'chat', sessionId: 'session', requestId: 'req_native_123456789', text: 'Altere diretamente o projeto.', attachments: [{ name: 'notes.txt', mime: 'text/plain', contentBase64: Buffer.from('selected attachment').toString('base64') }], projectFiles: ['src/main.ts'], effort: 'xhigh' }
  return { root, engine, request, calls, archived, handlers: () => handlers }
}
test('native submits only prompt and selected local files with normal host tools', async (t) => {
  const { engine, request, calls, handlers } = await fixture(t)
  await Promise.all([engine.prepare(request), engine.prepare(request)])
  assert.equal(calls.filter((call) => call.method === 'turn/start').length, 1)
  const start = calls.find((call) => call.method === 'thread/start').params
  assert.equal(start.cwd, '/project'); assert.equal(start.sandbox, 'danger-full-access'); assert.equal(start.approvalPolicy, 'never')
  assert.equal(start.dynamicTools, undefined); assert.equal(start.baseInstructions, undefined); assert.equal(start.config, undefined)
  assert.equal(handlers().features.code_mode_host, true); assert.equal(handlers().features.shell_tool, undefined)
  const turn = calls.find((call) => call.method === 'turn/start').params
  assert.equal(turn.sandboxPolicy.type, 'dangerFullAccess'); assert.equal(turn.effort, 'xhigh')
  assert.ok(turn.input[0].text.startsWith(request.text)); assert.doesNotMatch(turn.input[0].text, /\.zip|transport\.json|harness\.execution|base_context_sha256/)
  const record = await engine.owned('/project', 'chat')
  assert.equal(await readFile(record.attachments[0].path, 'utf8'), 'selected attachment')
  assert.match(turn.input[0].text, /src\/main\.ts/)
  await assert.rejects(engine.owned('/other', 'chat'))
})
test('native completes without response ZIP and preserves normal messages and execution items', async (t) => {
  const { engine, request, handlers, archived, root } = await fixture(t)
  await engine.prepare(request)
  const emit = handlers().onNotification
  emit('item/completed', { threadId: 'native-thread', turnId: 'native-turn', item: { id: 'command-1', type: 'commandExecution', command: 'node check.mjs', aggregatedOutput: 'passed', status: 'completed', exitCode: 0 } })
  emit('item/completed', { threadId: 'native-thread', turnId: 'native-turn', item: { id: 'answer', type: 'agentMessage', text: 'Alterações feitas e verificadas.' } })
  emit('turn/completed', { threadId: 'native-thread', turn: { id: 'native-turn', status: 'completed' } })
  await engine.flush()
  const record = (await engine.list('/project'))[0]
  assert.equal(record.status, 'completed'); assert.equal(record.error, '')
  assert.equal(record.messages.at(-1).text, 'Alterações feitas e verificadas.')
  assert.equal(record.activities[0].aggregatedOutput, 'passed')
  const ledger = await readFile(path.join(root, 'history', `${request.requestId}.jsonl`), 'utf8')
  assert.match(ledger, /commandExecution/); assert.match(ledger, /Alterações feitas/)
  for (let attempt = 0; attempt < 100 && archived.length < 3; attempt++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(archived.map((item) => item.kind), ['codex_transcript', 'codex_prompt', 'codex_attachment'])
})
test('exact questions are answered once and secret replies never enter state or ledger', async (t) => {
  const { engine, request, handlers, root } = await fixture(t)
  await engine.prepare(request)
  const reply = handlers().onRequest({ id: 22, method: 'item/tool/requestUserInput', params: { threadId: 'native-thread', turnId: 'native-turn', itemId: 'question', isBlocking: true,
    questions: [{ id: 'key', header: 'Credential', question: 'Introduza a credencial.', isSecret: true }] } })
  for (let attempt = 0; attempt < 100 && !(await engine.list('/project'))[0].pendingAsks.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 5))
  const record = (await engine.list('/project'))[0]
  assert.equal(record.status, 'waiting')
  const ask = record.pendingAsks[0]
  await assert.rejects(engine.answer('/other', 'chat', request.requestId, ask.id, {}))
  await assert.rejects(engine.answer('/project', 'chat', 'req_other', ask.id, {}))
  await assert.rejects(engine.answer('/project', 'chat', request.requestId, ask.id, { answers: {} }))
  await engine.answer('/project', 'chat', request.requestId, ask.id, { answers: { key: { answers: ['private-test-credential'] } } })
  assert.deepEqual(await reply, { answers: { key: { answers: ['private-test-credential'] } } })
  await assert.rejects(engine.answer('/project', 'chat', request.requestId, ask.id, {}))
  assert.equal((await engine.list('/project'))[0].status, 'running')
  handlers().onNotification('item/completed', { threadId: 'native-thread', turnId: 'native-turn', item: { id: 'echo', type: 'agentMessage', text: 'Echo: private-test-credential' } })
  await engine.flush()
  assert.doesNotMatch(JSON.stringify(await engine.list('/project')), /private-test-credential/)
  assert.doesNotMatch(await readFile(path.join(root, 'bindings.json'), 'utf8'), /private-test-credential/)
  assert.doesNotMatch(await readFile(path.join(root, 'history', `${request.requestId}.jsonl`), 'utf8'), /private-test-credential/)
})
test('cancel retires outstanding questions and cannot resume on a late completion', async (t) => {
  const { engine, request, handlers } = await fixture(t)
  await engine.prepare(request)
  const reply = handlers().onRequest({ id: 23, method: 'item/tool/requestUserInput', params: { threadId: 'native-thread', turnId: 'native-turn', itemId: 'question', questions: [{ id: 'a', question: 'Continue?', header: 'Next' }] } })
  const rejection = assert.rejects(reply, /encerrada/)
  for (let attempt = 0; attempt < 100 && !(await engine.list('/project'))[0].pendingAsks.length; attempt++) await new Promise((resolve) => setTimeout(resolve, 5))
  await engine.cancel('/project', 'chat', request.requestId); await rejection
  handlers().onNotification('turn/completed', { threadId: 'native-thread', turn: { id: 'native-turn', status: 'completed' } })
  await engine.flush()
  assert.equal((await engine.list('/project'))[0].status, 'idle')
  assert.deepEqual((await engine.list('/project'))[0].pendingAsks, [])
})
test('restart preserves uncertain native work and refuses automatic replay', async (t) => {
  const { engine, request, root } = await fixture(t)
  await engine.prepare(request)
  const calls = []
  const restored = createNativeCodexEngine({ root, publish() {}, rpcFactory: () => ({ ready: async () => {}, stop: async () => {}, call: async (method) => calls.push(method) }) })
  const record = (await restored.list('/project'))[0]
  assert.equal(record.status, 'attention'); assert.deepEqual(record.pendingAsks, [])
  await assert.rejects(restored.prepare(request), /reiniciou/)
  assert.deepEqual(calls, [])
})
test('selecting another account never moves a live request or routes cancellation to the new profile', async (t) => {
  const { engine, request, calls } = await fixture(t)
  await engine.prepare(request)
  const other = await engine.accounts.create('Other')
  assert.equal(await engine.accounts.selected(), other.id)
  assert.equal((await engine.list('/project'))[0].accountId, 'default')
  await engine.cancel('/project', 'chat', request.requestId)
  assert.equal(calls.at(-1).method, 'turn/interrupt')
  assert.equal(calls.at(-1).params.threadId, 'native-thread')
  assert.equal(calls.filter((call) => call.method === 'turn/start').length, 1)
})

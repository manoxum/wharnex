import test from 'node:test'
import assert from 'node:assert/strict'
import { registerNativeCodexIPC } from './ipc.mjs'

function fixture(t, session) {
  const handlers = new Map(), prepared = []
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => session }))
  registerNativeCodexIPC({ app: { on() {}, getPath: () => '/runtime' }, BACKEND_URL: 'http://127.0.0.1:8080' }, {
    handle: (name, action) => handlers.set(name, action), send() {}, accountChanged() {}, legacy: () => ({ list: async () => [] }),
    createEngine: () => ({ prepare: async (request) => { prepared.push(request); return { ok: true } } }),
  })
  return { prepared, call: (request) => handlers.get('native-prepare')({ projectPath: '/project' }, request) }
}
const request = { projectPath: '/spoofed', cacheKey: 'chat', sessionId: 'session', requestId: 'req_native_123456789', text: 'Meu pedido literal', attachments: [], projectFiles: ['src/main.ts'], effort: 'xhigh', config: { arbitrary: true }, baseInstructions: 'injected' }
test('native IPC sends a closed payload and independently verifies backend chat ownership', async (t) => {
  const session = { project_path: '/project', chat_id: 'chat' }
  const { call, prepared } = fixture(t, session)
  await call(request)
  assert.equal(prepared[0].projectPath, '/project')
  assert.equal(prepared[0].text, request.text)
  assert.equal(prepared[0].effort, 'xhigh')
  assert.equal(prepared[0].config, undefined); assert.equal(prepared[0].baseInstructions, undefined)
  assert.equal(prepared[0].selfEvolution, false)
  session.self_evolution = true; await call({ ...request, selfEvolution: false }); assert.equal(prepared.at(-1).selfEvolution, true)
  session.chat_id = 'other'; await assert.rejects(call(request), /não pertence/)
  session.chat_id = 'chat'; session.project_path = '/other'; await assert.rejects(call(request), /não pertence/)
  assert.equal(prepared.length, 2)
})
test('native IPC refuses unresolved Wharnex work rather than silently resubmitting it', async (t) => {
  const session = { project_path: '/project', chat_id: 'chat' }
  const { call, prepared } = fixture(t, session)
  for (const [key, value] of [['pending_manual_request_ids', ['req_old']], ['planner_in_flight', true], ['interrupted_execution', {}]]) {
    session[key] = value
    await assert.rejects(call(request), /pedido Wharnex pendente/)
    delete session[key]
  }
  assert.equal(prepared.length, 0)
})

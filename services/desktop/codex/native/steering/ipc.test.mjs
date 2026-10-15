import test from 'node:test'
import assert from 'node:assert/strict'
import { registerNativeCodexIPC } from '../ipc.mjs'

test('native guidance IPC takes project ownership from its trusted scope and forwards only the narrow input vocabulary', async () => {
  const handlers = new Map(), calls = []
  registerNativeCodexIPC({ app: { on() {}, getPath: () => '/runtime' }, BACKEND_URL: 'http://127.0.0.1:8080' }, {
    handle: (name, handler) => handlers.set(name, handler), send() {}, accountChanged() {}, legacy() {},
    createEngine: () => ({ steer: async (...args) => { calls.push(args); return { ok: true } } }),
  })
  const attachments = [{ name: 'selected.txt', mime: 'text/plain', contentBase64: 'b2s=' }]
  await handlers.get('native-steer')({ projectPath: '/owned' }, { projectPath: '/spoofed', chatId: 'chat', requestId: 'req_active', commentId: 'increment', text: 'Guidance', attachments,
    accountId: 'other-account', threadId: 'other-thread', expectedTurnId: 'other-turn', method: 'turn/start', permissions: { full: true } })
  assert.deepEqual(calls, [['/owned', 'chat', 'req_active', 'increment', 'Guidance', attachments]])
})

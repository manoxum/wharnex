import test from 'node:test'
import assert from 'node:assert/strict'
import { registerCodexIPC } from './ipc.mjs'

function fixture() {
  const handlers = new Map(); const sent = []; let callbacks
  const state = { id: 'window-one', projects: new Set(['/project']), window: { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } } }
  registerCodexIPC({ ipcMain: { handle: (name, action) => handlers.set(name, action) }, app: { on() {}, getPath: () => '/runtime' },
    canonicalProjectPath: (value) => value, trustedSender: (event) => { if (event.sender !== 'trusted') throw new Error('Untrusted'); return state },
  }, { createEngine: (value) => { callbacks = value; return { list: async () => [], rpc: { ready: async () => {}, call: async () => ({}) } } } })
  return { handlers, sent, state, callbacks: () => callbacks, call: (name, request, sender = 'trusted') => handlers.get(`wharnex:codex:${name}`)({ sender }, request) }
}
test('every Codex operation requires a trusted owning project window', async () => {
  const { handlers, call } = fixture()
  for (const name of handlers.keys()) {
    const action = name.split(':').at(-1)
    await assert.rejects(call(action, { projectPath: '/other' }), /não pertence/)
    await assert.rejects(call(action, { projectPath: '/project' }, 'remote'), /Untrusted/)
  }
})
test('Codex streams are scoped, reference counted and revoked on project release', async () => {
  const { call, callbacks, state, sent } = fixture()
  await call('subscribe', { projectPath: '/project' }); await call('subscribe', { projectPath: '/project' })
  await call('threads', { projectPath: '/project' })
  const record = { projectPath: '/other', chatId: 'chat', messages: [] }
  callbacks().publish(record); assert.equal(sent.length, 0)
  record.projectPath = '/project'; callbacks().publish(record); assert.equal(sent.length, 1)
  await call('unsubscribe', { projectPath: '/project' }); callbacks().publish(record); assert.equal(sent.length, 2)
  state.projects.clear(); callbacks().publish(record); assert.equal(sent.length, 2)
})

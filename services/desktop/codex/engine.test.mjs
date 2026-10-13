import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCodexEngine } from './engine.mjs'
import { writeChatInputZip } from '../transport/chat-input-zip-writer.mjs'
import { buildBundleName } from '../transport/bundlename.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-codex-engine-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []; const delivered = []; let handlers
  const rpc = { ready: async () => {}, stop() {}, call: async (method, params) => {
    calls.push({ method, params })
    if (method === 'config/read') return { config: { mcp_servers: { hostile: {} }, plugins: { hostile: {} } } }
    if (method === 'thread/start') return { thread: { id: 'thread-owned' }, model: 'test-model' }
    if (method === 'thread/resume') return { thread: { id: params.threadId }, model: 'test-model' }
    if (method === 'turn/start') return { turn: { id: `turn-${calls.length}` } }
    return {}
  } }
  const engine = createCodexEngine({ root, rpcFactory: (value) => { handlers = value; return rpc }, publish() {}, deliver: async (record) => delivered.push(record.requestId),
    withRequestPreparationDeadline: (_signal, action) => action(),
    materializeChatInput: async () => {
      const archivePath = path.join(root, `input-${calls.length}.zip`)
      await writeChatInputZip(archivePath, [{ name: 'transport.json', bytes: Buffer.from('{}') }])
      return { archivePath }
    } })
  const requestId = 'req_20261012T093000_1adfea24039ba474'
  const request = { projectPath: '/project', cacheKey: 'chat-owned', sessionId: 'session', requestId, text: 'Bundled instruction', expectedFilename: buildBundleName('res', 'chat-owned', requestId) }
  return { engine, request, calls, delivered, handlers: () => handlers }
}
test('Codex deduplicates submissions and disables host tools, MCP and plugins', async (t) => {
  const { engine, request, calls } = await fixture(t)
  await Promise.all([engine.prepare(request), engine.prepare(request)])
  await engine.prepare(request)
  assert.equal(calls.filter((call) => call.method === 'turn/start').length, 1)
  const start = calls.find((call) => call.method === 'thread/start').params
  assert.equal(start.sandbox, 'read-only')
  assert.equal(start.approvalPolicy, 'never')
  assert.equal(start.config['features.shell_tool'], false)
  assert.equal(start.config['features.unified_exec'], false)
  assert.equal(start.config['features.hooks'], false)
  assert.equal(start.config.mcp_servers.hostile.enabled, false)
  assert.equal(start.config.plugins.hostile.enabled, false)
  assert.notEqual(start.cwd, request.projectPath)
  assert.deepEqual(start.dynamicTools.map((tool) => tool.name), ['wharnex_archive_digest', 'wharnex_archive_read', 'wharnex_archive_create'])
  const turn = calls.find((call) => call.method === 'turn/start').params
  assert.equal(turn.input[0].text.includes(request.text), false)
  await assert.rejects(engine.owned('/other-project', request.cacheKey))
})
test('only a completed owned turn delivers a durable ZIP until acknowledgment', async (t) => {
  const { engine, request, calls, delivered, handlers } = await fixture(t)
  await engine.prepare(request)
  const turnId = `turn-${calls.length}`
  await assert.rejects(handlers().onRequest({ method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-owned' } }))
  await assert.rejects(handlers().onRequest({ method: 'item/tool/call', params: { threadId: 'other-thread', tool: 'wharnex_archive_read', arguments: {} } }))
  await handlers().onRequest({ method: 'item/tool/call', params: { threadId: 'thread-owned', turnId, tool: 'wharnex_archive_create', arguments: { entries: [{ path: 'turn.json', content: '{}' }] } } })
  handlers().onNotification('turn/completed', { threadId: 'thread-owned', turn: { id: turnId, status: 'completed' } })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.deepEqual(delivered, [request.requestId])
  assert.equal((await engine.pending('/project')).length, 1)
  assert.equal((await engine.pending('/other-project')).length, 0)
  await engine.acknowledge('/project', request.cacheKey, request.requestId)
  assert.equal((await engine.pending('/project')).length, 0)
})
test('a restart preserves uncertain requests without submitting them again', async (t) => {
  const { engine, request } = await fixture(t)
  await engine.prepare(request)
  const root = path.dirname((await engine.owned('/project', request.cacheKey)).inputPath)
  let submitted = false
  const recovered = createCodexEngine({ root, rpcFactory: () => ({ ready: async () => {}, call: async () => { submitted = true }, stop() {} }), publish() {}, deliver() {} })
  await assert.rejects(recovered.prepare(request), /reinício/)
  assert.equal(submitted, false)
  assert.equal((await recovered.list('/project'))[0].status, 'attention')
})

test('cancel interrupts an uncertain turn and late start notifications cannot revive it', async (t) => {
  const { engine, request, calls, handlers } = await fixture(t)
  await engine.prepare(request)
  const record = await engine.owned('/project', request.cacheKey)
  record.status = 'attention'
  await engine.cancel('/project', request.cacheKey, request.requestId)
  assert.equal(calls.at(-1).method, 'turn/interrupt')
  handlers().onNotification('turn/started', { threadId: record.threadId, turn: { id: record.turnId } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await engine.list('/project'))[0].status, 'idle')
})

test('concurrent distinct request identities cannot share a preparation result', async (t) => {
  const { engine, request, calls } = await fixture(t)
  const first = engine.prepare(request)
  await assert.rejects(engine.prepare({ ...request, requestId: `${request.requestId}_next` }), /outro pedido/)
  await first
  assert.equal(calls.filter((call) => call.method === 'turn/start').length, 1)
})

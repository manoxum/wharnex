import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CodexRPC } from './rpc.mjs'
import { createCodexEngine } from './engine.mjs'
import { writeChatInputZip } from '../transport/chat-input-zip-writer.mjs'
import { buildBundleName } from '../transport/bundlename.mjs'

// Real packaged app-server, local deterministic Responses server, no account,
// credentials, provider traffic, model inference or host execution.
test('official runtime reads the snapshot and returns a durable ZIP with no execution tools', { timeout: 25000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-codex-runtime-test-'))
  const home = path.join(root, 'codex-home')
  await mkdir(home)
  await writeFile(path.join(home, 'config.toml'), '[mcp_servers."hostile.with.dots"]\ncommand = "wharnex-must-never-execute"\n')
  const requests = []; const notifications = []
  let deliver
  const delivered = new Promise((resolve) => { deliver = resolve })
  const operations = [
    ['wharnex_archive_read', { path: 'transport.json' }],
    ['wharnex_archive_digest', { content: 'abc' }],
    ['wharnex_archive_create', { entries: [{ path: 'turn.json', content: '{"kind":"ask"}' }, { path: 'summary.md', content: 'Local protocol fixture' }] }],
  ]
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    const operation = operations[requests.length - 1]
    const item = operation ? { type: 'function_call', id: `fc-${requests.length}`, call_id: `call-${requests.length}`, name: operation[0], arguments: JSON.stringify(operation[1]) }
      : { type: 'message', id: 'final', role: 'assistant', content: [{ type: 'output_text', text: 'ZIP fixture delivered.' }] }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const event of [
      { type: 'response.created', response: { id: `response-${requests.length}`, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `response-${requests.length}`, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, input_tokens_details: { cached_tokens: 0 } } } },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const engine = createCodexEngine({ root: path.join(root, 'engine'), publish() {}, deliver,
    withRequestPreparationDeadline: (_signal, action) => action(),
    materializeChatInput: async () => {
      const archivePath = path.join(root, 'request.zip')
      await writeChatInputZip(archivePath, [{ name: 'transport.json', bytes: Buffer.from('{"snapshot":"owned"}') }])
      return { archivePath }
    },
    rpcFactory: (options) => {
      const rpc = new CodexRPC({ ...options, spawnImpl: (executable, args, settings) => spawn(executable, args, { ...settings, env: { ...settings.env, CODEX_HOME: home } }),
        onNotification: (method, params) => { notifications.push(method); options.onNotification(method, params) } })
      const call = rpc.call.bind(rpc)
      rpc.call = (method, params = {}) => call(method, method === 'thread/start' ? { ...params, model: 'gpt-5.4', config: { ...params.config,
        model_provider: 'wharnex_fixture', 'model_providers.wharnex_fixture': { name: 'Local fixture', base_url: `http://127.0.0.1:${server.address().port}/v1`, wire_api: 'responses', requires_openai_auth: false },
      } } : params)
      return rpc
    },
  })
  t.after(async () => { await engine.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const requestId = 'req_20261012T093000_1adfea24039ba474'
  await engine.prepare({ cacheKey: 'runtime-fixture', projectPath: '/fixture-project', sessionId: 'fixture', requestId, text: 'Use the archive tools only.', bootstrapText: 'Human fixture message', expectedFilename: buildBundleName('res', 'runtime-fixture', requestId) })
  await delivered
  assert.equal(requests.length, 4)
  assert.equal((await engine.list('/fixture-project'))[0].messages[0].role, 'user')
  assert.equal((await engine.list('/fixture-project'))[0].messages.at(-1)?.text, 'ZIP fixture delivered.')
  for (const request of requests) {
    const names = request.tools.map((tool) => tool.name)
    // Upstream always includes request_user_input; the RPC boundary refuses it.
    assert.deepEqual(names.filter((name) => name !== 'request_user_input').sort(), ['wharnex_archive_create', 'wharnex_archive_digest', 'wharnex_archive_read'])
  }
  assert.ok(JSON.stringify(requests[1].input).includes('owned'))
  assert.ok(JSON.stringify(requests[2].input).includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'))
  assert.equal(notifications.includes('mcpServer/startupStatus/updated'), false)
  assert.equal((await engine.pending('/fixture-project'))[0].requestId, requestId)
  await engine.acknowledge('/fixture-project', 'runtime-fixture', requestId)
  assert.equal((await engine.pending('/fixture-project')).length, 0)
  const record = await engine.owned('/fixture-project', 'runtime-fixture')
  record.status = 'attention' // Completed without a usable response is also cancellable.
  await engine.cancel('/fixture-project', 'runtime-fixture', requestId)
  assert.equal(record.status, 'idle')
})

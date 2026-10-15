import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CodexRPC } from '../../rpc.mjs'
import { createNativeCodexEngine } from '../engine.mjs'

test('the pinned official runtime accepts steering while its original turn is still generating', { timeout: 25000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-steer-runtime-'))
  const home = path.join(root, 'home'), project = path.join(root, 'project')
  await mkdir(home); await mkdir(project)
  const requests = []
  let started, release, complete
  const generating = new Promise((resolve) => { started = resolve })
  const released = new Promise((resolve) => { release = resolve })
  const completed = new Promise((resolve) => { complete = resolve })
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    const number = requests.length
    if (number === 1) { started(); await released }
    const item = number === 1
      ? { type: 'function_call', id: 'fc-read', call_id: 'call-read', name: 'exec_command', arguments: JSON.stringify({ cmd: 'pwd', workdir: project, max_output_tokens: 128 }) }
      : { type: 'message', id: 'final', role: 'assistant', content: [{ type: 'output_text', text: 'Steered response.' }] }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const event of [
      { type: 'response.created', response: { id: `r-${number}`, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `r-${number}`, status: 'completed', output: [item] } },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const methods = []
  const engine = createNativeCodexEngine({ root: path.join(root, 'engine'), publish() {}, rpcFactory: (options) => {
    const rpc = new CodexRPC({ ...options,
      spawnImpl: (exe, args, settings) => spawn(exe, args, { ...settings, env: { ...settings.env, CODEX_HOME: home } }),
      onNotification: (method, params) => { options.onNotification(method, params); if (method === 'turn/completed') complete() },
    })
    const call = rpc.call.bind(rpc)
    rpc.call = (method, params = {}) => {
      methods.push(method)
      return call(method, method === 'thread/start' ? { ...params, model: 'gpt-5.4', config: {
        model_provider: 'wharnex_fixture', 'features.unified_exec': true, 'features.code_mode_only': false,
        'model_providers.wharnex_fixture': { name: 'Fixture', base_url: `http://127.0.0.1:${server.address().port}/v1`, wire_api: 'responses', requires_openai_auth: false },
      } } : params)
    }
    return rpc
  } })
  t.after(async () => { release(); await engine.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  await engine.prepare({ projectPath: project, cacheKey: 'chat', sessionId: 'session', requestId: 'req_steer_real_12345678', text: 'Read the project directory.', attachments: [], projectFiles: [] })
  await generating
  await engine.steer(project, 'chat', 'req_steer_real_12345678', 'increment', 'Also explain the regression test.', [])
  assert.equal((await engine.list(project))[0].status, 'running')
  release(); await completed; await engine.flush()
  assert.equal(methods.filter((method) => method === 'turn/start').length, 1)
  assert.equal(methods.filter((method) => method === 'turn/steer').length, 1)
  assert.ok(requests.slice(1).some((request) => JSON.stringify(request.input).includes('Also explain the regression test.')))
  assert.equal((await engine.list(project))[0].messages.at(-1).text, 'Steered response.')
})

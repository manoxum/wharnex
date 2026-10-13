import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CodexRPC } from '../rpc.mjs'
import { createNativeCodexEngine } from './engine.mjs'

test('real native runtime changes its host project and asks the user without ZIPs', { timeout: 25000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-native-runtime-'))
  const home = path.join(root, 'home'), project = path.join(root, 'project')
  await mkdir(home); await mkdir(project)
  const requests = []
  let complete
  const completed = new Promise((resolve) => { complete = resolve })
  const operations = [
    ['exec_command', { cmd: `node -e 'require("node:fs").writeFileSync("native-result.txt","native-host-change")'`, workdir: project, max_output_tokens: 1000, yield_time_ms: 1000 }],
    ['request_user_input', { questions: [{ id: 'next', header: 'Next', question: 'Qual é o próximo passo?', options: [{ label: 'Concluir', description: 'Finalizar a tarefa.' }, { label: 'Continuar', description: 'Trabalhar mais.' }] }] }],
  ]
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    const operation = operations[requests.length - 1]
    const item = operation ? { type: 'function_call', id: `fc-${requests.length}`, call_id: `call-${requests.length}`, name: operation[0], arguments: JSON.stringify(operation[1]) }
      : { type: 'message', id: 'final', role: 'assistant', content: [{ type: 'output_text', text: 'Native finished.' }] }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const event of [
      { type: 'response.created', response: { id: `r-${requests.length}`, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `r-${requests.length}`, status: 'completed', output: [item] } },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const engine = createNativeCodexEngine({ root: path.join(root, 'engine'), publish() {}, rpcFactory: (options) => {
    const rpc = new CodexRPC({ ...options, spawnImpl: (exe, args, settings) => spawn(exe, args, { ...settings, env: { ...settings.env, CODEX_HOME: home } }),
      onNotification: (method, params) => { options.onNotification(method, params); if (method === 'turn/completed') complete() },
    })
    const call = rpc.call.bind(rpc)
    rpc.call = (method, params = {}) => call(method, method === 'thread/start' ? { ...params, model: 'gpt-5.4', config: {
      model_provider: 'wharnex_fixture', 'features.unified_exec': true, 'features.code_mode_only': false,
      'model_providers.wharnex_fixture': { name: 'Fixture', base_url: `http://127.0.0.1:${server.address().port}/v1`, wire_api: 'responses', requires_openai_auth: false },
    } } : params)
    return rpc
  } })
  t.after(async () => { await engine.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const requestId = 'req_native_real_123456789'
  await engine.prepare({ projectPath: project, cacheKey: 'chat', sessionId: 'session', requestId, text: 'Make the requested change and ask me what follows.', attachments: [], projectFiles: [] })
  let thread
  for (let attempt = 0; attempt < 500; attempt++) {
    thread = (await engine.list(project))[0]
    if (thread.pendingAsks?.length || ['completed', 'attention'].includes(thread.status)) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(await readFile(path.join(project, 'native-result.txt'), 'utf8'), 'native-host-change')
  assert.equal(thread.status, 'waiting')
  assert.equal(thread.pendingAsks[0].questions[0].id, 'next')
  await engine.answer(project, 'chat', requestId, thread.pendingAsks[0].id, { answers: { next: { answers: ['Concluir'] } } })
  await completed; await engine.flush()
  assert.equal((await engine.list(project))[0].status, 'completed')
  assert.equal((await engine.list(project))[0].messages.at(-1).text, 'Native finished.')
  assert.ok(JSON.stringify(requests[2].input).includes('Concluir'))
  const tools = requests[0].tools.map((tool) => tool.name)
  assert.ok(tools.includes('exec_command')); assert.ok(tools.includes('request_user_input'))
  assert.equal(tools.some((name) => name?.startsWith('wharnex_archive')), false)
  const user = requests[0].input.filter((item) => item.role === 'user')
  assert.doesNotMatch(JSON.stringify(user), /transport\.json|\.zip|harness\.execution/)
})

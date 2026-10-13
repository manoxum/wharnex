import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CodexRPC } from './rpc.mjs'
import { createCodexEngine } from './engine.mjs'
import { writeChatInputZip } from '../transport/chat-input-zip-writer.mjs'
import { buildBundleName } from '../transport/bundlename.mjs'

// Exercise the actual Code Mode dispatch used by models which wrap dynamic
// tools in functions.exec, rather than mocking a direct archive function call.
test('Code Mode host can read the owned ZIP without granting host tools', { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-codex-code-mode-'))
  const home = path.join(root, 'home')
  await mkdir(home)
  const requests = []
  let finish
  const settled = new Promise((resolve) => { finish = resolve })
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    const item = requests.length === 1
      ? { type: 'custom_tool_call', id: 'fc-read', call_id: 'call-read', name: 'exec', namespace: 'functions', input: `
text({shell:typeof tools.exec_command,patch:typeof tools.apply_patch,node:typeof process});
text(await tools.wharnex_archive_read({path:"transport.json"}));
text(await tools.wharnex_archive_digest({content:"abc"}));
text(await tools.wharnex_archive_create({entries:[{path:"turn.json",content:"{}"}]}));` }
      : { type: 'message', id: 'final', role: 'assistant', content: [{ type: 'output_text', text: 'Read finished.' }] }
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
  const engine = createCodexEngine({ root: path.join(root, 'engine'), publish() {}, deliver() {},
    withRequestPreparationDeadline: (_signal, action) => action(),
    materializeChatInput: async () => {
      const archivePath = path.join(root, 'request.zip')
      await writeChatInputZip(archivePath, [{ name: 'transport.json', bytes: Buffer.from('{"snapshot":"owned-code-mode"}') }])
      return { archivePath }
    },
    rpcFactory: (options) => {
      const rpc = new CodexRPC({ ...options,
        spawnImpl: (executable, args, settings) => spawn(executable, args, { ...settings, env: { ...settings.env, CODEX_HOME: home } }),
        onNotification: (method, params) => { options.onNotification(method, params); if (method === 'turn/completed') finish() },
      })
      const call = rpc.call.bind(rpc)
      rpc.call = (method, params = {}) => call(method, method === 'thread/start' ? { ...params, model: 'gpt-5.4', config: { ...params.config,
        'features.code_mode_only': true, model_provider: 'wharnex_fixture',
        'model_providers.wharnex_fixture': { name: 'Local fixture', base_url: `http://127.0.0.1:${server.address().port}/v1`, wire_api: 'responses', requires_openai_auth: false },
      } } : params)
      return rpc
    },
  })
  t.after(async () => { await engine.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  const requestId = 'req_20261012T093000_1adfea24039ba474'
  await engine.prepare({ cacheKey: 'code-mode', projectPath: '/fixture', sessionId: 'fixture', requestId, text: 'Read the ZIP.', expectedFilename: buildBundleName('res', 'code-mode', requestId) })
  await settled
  assert.equal(requests.length, 2)
  const result = JSON.stringify(requests[1].input.filter((item) => item.type === 'custom_tool_call_output'))
  assert.doesNotMatch(result, /code.mode host is disabled/i)
  assert.match(result, /owned-code-mode/)
  assert.match(result, /ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad/)
  assert.match(result, /shell.*undefined.*patch.*undefined.*node.*undefined/)
  const declared = requests[0].tools.flatMap((tool) => [tool.name, ...(tool.tools || []).map((nested) => nested.name)])
  assert.equal(declared.some((name) => ['exec_command', 'shell_command', 'apply_patch'].includes(name)), false)
  // Completion processing saves the ZIP asynchronously after the notification.
  for (let attempt = 0; attempt < 100 && !(await engine.pending('/fixture')).length; attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal((await engine.pending('/fixture'))[0].requestId, requestId)
})

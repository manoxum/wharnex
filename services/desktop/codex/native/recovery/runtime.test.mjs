import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CodexRPC } from '../../rpc.mjs'
import { createNativeCodexEngine } from '../engine.mjs'

test('real Codex continuation preserves history after restart and across isolated account profiles', { timeout: 30000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'wharnex-native-resume-')), project = path.join(root, 'project')
  await mkdir(project)
  const inputs = []
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    inputs.push(JSON.parse(body).input)
    const item = { type: 'message', id: `reply-${inputs.length}`, role: 'assistant', content: [{ type: 'output_text', text: `Native response ${inputs.length}` }] }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const event of [
      { type: 'response.created', response: { id: `r-${inputs.length}`, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item }, { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `r-${inputs.length}`, status: 'completed', output: [item] } },
    ]) response.write(`data: ${JSON.stringify(event)}\n\n`)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  let engine, competitor
  function create() {
    return createNativeCodexEngine({ root: path.join(root, 'engine'), publish() {}, rpcFactory: (options) => {
      const rpc = new CodexRPC(options), call = rpc.call.bind(rpc)
      rpc.call = (method, params = {}) => call(method, ['thread/start', 'thread/resume'].includes(method) ? { ...params, model: 'gpt-5.4', config: {
        model_provider: 'wharnex_fixture', 'features.code_mode_only': false,
        'model_providers.wharnex_fixture': { name: 'Fixture', base_url: `http://127.0.0.1:${server.address().port}/v1`, wire_api: 'responses', requires_openai_auth: false },
      } } : params)
      return rpc
    } })
  }
  t.after(async () => { await competitor?.close(); await engine?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  async function waitForCompletion() {
    for (let attempt = 0; attempt < 500; attempt++) {
      await engine.flush(); const record = (await engine.list(project))[0]
      if (['completed', 'attention'].includes(record?.status)) { assert.equal(record.status, 'completed', record.error); return record }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.fail('Native continuation did not complete')
  }
  engine = create()
  const firstAccount = await engine.accounts.create('First')
  await engine.prepare({ projectPath: project, cacheKey: 'chat', sessionId: 'session', requestId: 'req_native_resume_123456789', text: 'Remember original native work.', attachments: [], projectFiles: [], permissionLevel: 'ask' })
  const original = await waitForCompletion()
  await engine.cancel(project, 'chat', original.requestId)
  competitor = create()
  await assert.rejects(competitor.resume(project, 'chat', original.requestId, 'Continue while another client owns the writer.', false), (error) => error.reason === 'threadWriterBusy')
  assert.equal((await competitor.list(project))[0].requestId, original.requestId)
  await competitor.close(); competitor = undefined
  await engine.close()
  engine = create()
  assert.equal((await engine.list(project))[0].resumeAvailable, true)
  await engine.resume(project, 'chat', original.requestId, 'Continue after restart.', false)
  const continued = await waitForCompletion()
  assert.equal(continued.threadId, original.threadId); assert.equal(continued.accountId, firstAccount.id); assert.equal(continued.permissionLevel, 'ask')
  assert.match(JSON.stringify(inputs[1]), /Remember original native work/); assert.match(JSON.stringify(inputs[1]), /Continue after restart/)
  await engine.cancel(project, 'chat', continued.requestId)
  const secondAccount = await engine.accounts.create('Second')
  await engine.resume(project, 'chat', continued.requestId, 'Continue using the selected account.', true)
  const transferred = await waitForCompletion()
  assert.equal(transferred.threadId, original.threadId); assert.equal(transferred.accountId, secondAccount.id); assert.equal(transferred.selfEvolution, true)
  assert.match(JSON.stringify(inputs[2]), /Remember original native work/); assert.match(JSON.stringify(inputs[2]), /Continue after restart/); assert.match(JSON.stringify(inputs[2]), /Modo Auto Evolution/)
  await engine.cancel(project, 'chat', transferred.requestId)
  await engine.resume(project, 'chat', transferred.requestId, undefined, true)
  const played = await waitForCompletion()
  assert.equal(played.threadId, original.threadId); assert.equal(played.accountId, secondAccount.id)
  assert.match(JSON.stringify(inputs[3]), /Continue o pedido anterior/)
  assert.match(JSON.stringify(inputs[3]), /Remember original native work/)
})

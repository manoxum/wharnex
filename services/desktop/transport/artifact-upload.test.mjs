import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { uploadChatArtifact } from './artifact-upload.mjs'
import { withTrace } from '../observability/operational-trace.mjs'

async function withServer(handler, run) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try { return await run(`http://127.0.0.1:${server.address().port}`) }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
}

test('concurrent large uploads arrive complete with their task trace', async () => {
  const received = []
  let active = 0
  let peak = 0
  await withServer(async (request, response) => {
    active += 1
    peak = Math.max(peak, active)
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    received.push({ path: request.url, trace: request.headers['x-wharnex-trace'], payload })
    await new Promise((resolve) => setTimeout(resolve, 20))
    response.writeHead(201, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ id: `artifact_${received.length}` }))
    active -= 1
  }, async (baseURL) => {
    const bytes = Buffer.alloc(15 * 1024 * 1024, 97)
    const artifact = { requestId: 'req_1', direction: 'input', kind: 'bundle', filename: 'whx-test.zip', contentType: 'application/zip', bytes }
    const result = await withTrace('task:cat_1:1', () => Promise.all([
      uploadChatArtifact(baseURL, 'ses_1', artifact),
      uploadChatArtifact(baseURL, 'ses_2', artifact),
    ]))
    assert.equal(result.length, 2)
    assert.equal(peak, 1, 'large artifact uploads must not compete for the Desktop network link')
    assert.deepEqual(received.map((item) => item.path).sort(), ['/api/sessions/ses_1/artifacts', '/api/sessions/ses_2/artifacts'])
    for (const item of received) {
      assert.equal(item.trace, 'task:cat_1:1')
      assert.equal(item.payload.content_base64.length, 20 * 1024 * 1024)
      assert.deepEqual(Buffer.from(item.payload.content_base64, 'base64'), bytes)
    }
  })
})

test('upload preserves backend errors and caller cancellation', async () => {
  await withServer((_request, response) => {
    response.writeHead(503, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { code: 'artifact_unavailable', message: 'storage is unavailable' } }))
  }, async (baseURL) => {
    await assert.rejects(
      uploadChatArtifact(baseURL, 'ses_1', { requestId: 'req_1', direction: 'input', kind: 'bundle', filename: 'whx-test.zip', bytes: Buffer.from('x') }),
      /artifact_unavailable: storage is unavailable/,
    )
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      uploadChatArtifact(baseURL, 'ses_1', { requestId: 'req_1', direction: 'input', kind: 'bundle', filename: 'whx-test.zip', bytes: Buffer.from('x') }, controller.signal),
      { name: 'AbortError' },
    )
  })
})

test('stalled artifact persistence is bounded and releases its connection', async () => {
  await withServer((_request, _response) => {}, async (baseURL) => {
    await assert.rejects(
      uploadChatArtifact(baseURL, 'ses_1', {
        requestId: 'req_1', direction: 'input', kind: 'bundle', filename: 'whx-test.zip', bytes: Buffer.from('x'),
      }, undefined, { timeoutMs: 25 }),
      /Artifact persistence exceeded 25 ms/,
    )
  })
})

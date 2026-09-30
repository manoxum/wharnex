import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { postLongRunningWorkerJSON } from './chat-agent-long-request.mjs'
import { withTrace } from '../../observability/operational-trace.mjs'

async function localServer(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, baseURL: `http://127.0.0.1:${server.address().port}` }
}

test('Worker bundle POST waits for a delayed backend result and preserves its task trace', async () => {
  let receivedTrace = ''
  const { server, baseURL } = await localServer((request, response) => {
    receivedTrace = request.headers['x-wharnex-trace']
    request.resume()
    request.on('end', () => setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"task":{"status":"REVIEW"}}')
    }, 20))
  })
  try {
    const result = await withTrace('task:cat_1:1', () => postLongRunningWorkerJSON(baseURL, '/worker-bundle', { filename: 'exact.zip' }, 1000))
    assert.equal(result.task.status, 'REVIEW')
    assert.equal(receivedTrace, 'task:cat_1:1')
  } finally { server.close() }
})

test('Worker bundle POST has an explicit bounded deadline', async () => {
  const { server, baseURL } = await localServer((request) => request.resume())
  try {
    await assert.rejects(postLongRunningWorkerJSON(baseURL, '/worker-bundle', {}, 10), /exceeded the backend deadline/)
  } finally { server.closeAllConnections(); server.close() }
})

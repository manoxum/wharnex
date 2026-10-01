import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGPTRequestContextClient } from './request-context.mjs'

const backendURL = 'http://127.0.0.1:8888'
const requestId = 'req_12345678'

test('request context combines the bounded ZIP, maps and current selection', async () => {
  const requested = []
  const responses = new Map([
    ['/api/sessions/abc/bundle', new Response(Buffer.from('PK00'), { headers: { 'content-length': '4' } })],
    ['/api/sessions/abc/context/maps', Response.json({ protocol: 'harness.context-map/v1', files: [{ path: 'context/a' }] })],
    ['/api/sessions/abc', Response.json({ context_mode: 'partial', context_paths: ['context/a'] })],
    ['/api/sessions/abc/git/context', Response.json({ protocol: 'harness.git-context/v1', files: [] })],
    [`/api/sessions/abc/requests/${requestId}/knowledge`, Response.json({ knowledge: { notes: ['one'] } })],
    [`/api/sessions/abc/requests/${requestId}/continuation`, Response.json({ files: [{ name: 'round.json' }] })],
  ])
  const client = createChatGPTRequestContextClient({
    backendURL, maxContextBytes: 16,
    fetchImpl: async (target, options) => {
      const pathname = new URL(target).pathname
      requested.push({ pathname, redirect: options.redirect })
      return responses.get(pathname) || new Response(null, { status: 404 })
    },
  })
  const context = await client.fetchSelectedContextZip('abc')
  assert.deepEqual(context.maps, [{ path: 'context/a' }])
  assert.deepEqual(context.paths, ['context/a'])
  assert.equal(context.mode, 'partial')
  assert.equal(context.bytes.toString(), 'PK00')
  assert.deepEqual(await client.fetchRequestGitContext('abc'), { protocol: 'harness.git-context/v1', files: [] })
  assert.deepEqual(await client.fetchRequestKnowledge('abc', requestId), { notes: ['one'] })
  assert.deepEqual(await client.fetchRequestContinuation('abc', requestId), [{ name: 'round.json' }])
  assert.equal(requested.length, 6)
  assert.ok(requested.every(({ redirect }) => redirect === 'error'))
})

test('request context rejects oversized or invalid bundles before returning them', async () => {
  const oversized = createChatGPTRequestContextClient({
    backendURL, maxContextBytes: 3,
    fetchImpl: async () => new Response(Buffer.from('PK00'), { headers: { 'content-length': '4' } }),
  })
  await assert.rejects(oversized.fetchContextZip('abc'), /exceeds 256 MiB/)
  const invalid = createChatGPTRequestContextClient({
    backendURL, maxContextBytes: 16,
    fetchImpl: async () => new Response(Buffer.from('not zip')),
  })
  await assert.rejects(invalid.fetchContextZip('abc'), /ZIP bundle/)
  await assert.rejects(invalid.fetchRequestKnowledge('abc', '../bad'), /Invalid request id/)
})

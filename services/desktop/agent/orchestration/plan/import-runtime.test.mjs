import test from 'node:test'
import assert from 'node:assert/strict'
import { createOrchestratorPlanImport } from './import-runtime.mjs'

function fixture(ok = true) {
  const requests = []
  const runtime = createOrchestratorPlanImport({
    sanitizeSessionId: (value) => value,
    BACKEND_URL: 'http://127.0.0.1:8888',
    fetch: async (url, request) => {
      requests.push({ url: String(url), request })
      return { ok, status: ok ? 200 : 422, json: async () => ok ? { plan: { id: 'plan-1' }, tasks: [] } : { error: { message: 'invalid plan' } } }
    },
  })
  return { runtime, requests }
}

test('bundle plan import forwards bounded bytes without decoding the archive', async () => {
  const { runtime, requests } = fixture()
  const bytes = Buffer.from('zip')
  const imported = await runtime.importOrchestratorPlanArtifact('session-1', 'orp_12345678T123456_1234567890abcdef', 'bundle', bytes)
  assert.equal(imported.plan.id, 'plan-1')
  assert.match(requests[0].url, /\/api\/sessions\/session-1\/orchestrator\/plans\/import-bundle\?request_id=/)
  assert.equal(requests[0].request.body, bytes)
  assert.equal(requests[0].request.headers['Content-Type'], 'application/zip')
})

test('legacy JSON plan still requires its exact protocol before import', async () => {
  const { runtime, requests } = fixture()
  await assert.rejects(
    runtime.importOrchestratorPlanArtifact('session-1', 'orp_12345678T123456_1234567890abcdef', 'json', Buffer.from('{"tasks":[]}')),
    /mismatched protocol/,
  )
  assert.deepEqual(requests, [])
})

test('retained invalid artifact falls back to live provider observation', async () => {
  const { runtime } = fixture(false)
  const result = await runtime.importRetainedOrchestratorPlan('session-1', 'orp_12345678T123456_1234567890abcdef', 'bundle', Buffer.from('zip'))
  assert.equal(result, undefined)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { orchestratorCompletionDiagnostic } from './chat-agent-orchestrator-progress.mjs'

test('orchestrator progress diagnostic exposes only bounded structural flags', () => {
  const result = orchestratorCompletionDiagnostic({
    assistantCount: 3, complete: true, thinking: false, failed: false,
    composerReady: true, prose: 'never log remote answer',
  }, 2, false)
  assert.deepEqual(result, {
    responseStarted: true, complete: true, thinking: false,
    failed: false, composerReady: true, downloadTriggered: false,
  })
  assert.equal(JSON.stringify(result).includes('remote answer'), false)
})

test('orchestrator progress diagnostic rejects unbounded or invalid turn counts', () => {
  const result = orchestratorCompletionDiagnostic({ assistantCount: 'not a count' }, 1, true)
  assert.equal(result.responseStarted, false)
  assert.equal(result.downloadTriggered, true)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chatAgentQueueDiagnostics } from './chat-agent-queue-diagnostics.mjs'

test('runtime queue diagnostics separate deferred work from claimable backlog', async () => {
  const diagnostics = chatAgentQueueDiagnostics({
    due: 2, scheduled: 3, guarded: 4, oldest_due_created_at: '2026-09-27T00:00:00Z',
    due_worker: 2,
  })
  assert.equal(diagnostics.due, 2)
  assert.equal(diagnostics.scheduled, 3)
  assert.equal(diagnostics.guarded, 4)
  assert.equal(diagnostics.oldest_due_created_at, '2026-09-27T00:00:00Z')
  assert.equal(diagnostics.due_worker, 2)
  assert.equal(diagnostics.oldest_created_at, undefined)

  const source = await readFile(new URL('./main.mjs', import.meta.url), 'utf8')
  const refreshStart = source.indexOf('async function refreshChatAgentRuntimeState(')
  const refresh = source.slice(refreshStart, source.indexOf('\nfunction chatAgentRuntimeState', refreshStart))
  assert.match(refresh, /chatAgentScheduler\.queueSummary\(\)/)
  assert.doesNotMatch(refresh, /chatAgentScheduler\.list\(\{ limit: 500 \}\)/)
})

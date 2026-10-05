import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chatAgentQueueDiagnostics } from './chat-agent-queue-diagnostics.mjs'
import { readDesktopCompositionSource } from '../../../composition/entry/source.mjs'

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

  const source = await readDesktopCompositionSource()
  const wiring = await readFile(new URL('../wiring/desktop.mjs', import.meta.url), 'utf8')
  const refreshSource = await readFile(new URL('../diagnostics/refresh.mjs', import.meta.url), 'utf8')
  assert.match(source, /compose\(ctx, 'agent-scheduling', ctx\.createDesktopAgentScheduling, \{/)
  assert.match(wiring, /d\.createChatAgentRuntimeRefresh\(\{/)
  assert.match(refreshSource, /scheduler\.queueSummary\(\)/)
  assert.doesNotMatch(refreshSource, /scheduler\.list\(\{ limit: 500 \}\)/)
})

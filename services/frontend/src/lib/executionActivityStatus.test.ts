import { expect, it } from 'vitest'
import type { HarnessEvent, Session } from '../types'
import { buildExecutionTimeline } from './executionTimeline'
import { currentMainRequestRoot, executionActivityOverview } from './executionActivityStatus'

const event = (id: string, type: string, timestamp: string, data: Record<string, unknown> = {}): HarnessEvent => ({
  id, session_id: 'ses-1', type, timestamp, data,
})

it('does not keep a historical Main Request active because a repair start was abandoned', () => {
  const entries = buildExecutionTimeline([
    event('failed', 'execution.failed', '2026-09-22T00:00:00Z', { request_id: 'req-old', root_request_id: 'req-old' }),
    event('repair', 'repair.started', '2026-09-22T00:01:00Z', { request_id: 'req-repair', root_request_id: 'req-old', iteration_kind: 'repair' }),
  ])

  expect(executionActivityOverview(entries, true)).toBe('active')
  expect(executionActivityOverview(entries, false)).toBe('failed')
})

it('lets a later terminal lifecycle event outrank an earlier orphaned running command', () => {
  const entries = buildExecutionTimeline([
    event('started', 'execution.started', '2026-09-22T00:00:00Z', { request_id: 'req-main', root_request_id: 'req-main' }),
    event('command', 'command.started', '2026-09-22T00:01:00Z', { run_id: 'run-orphan', argv: ['npm', 'test'] }),
    event('completed', 'execution.completed', '2026-09-22T00:02:00Z', { request_id: 'req-main', root_request_id: 'req-main' }),
  ])

  expect(executionActivityOverview(entries)).toBe('success')
})

it('maps the latest continuation request back to its Main Request root', () => {
  const session = {
    last_request_id: 'req-repair',
    request_lineages: {
      'req-repair': { request_id: 'req-repair', root_request_id: 'req-main', kind: 'repair', created_at: '2026-09-22T00:00:00Z' },
    },
  } as unknown as Session

  expect(currentMainRequestRoot(session)).toBe('req-main')
})

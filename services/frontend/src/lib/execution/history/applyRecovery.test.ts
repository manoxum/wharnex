import { expect, it } from 'vitest'
import type { HarnessEvent } from '../../../types'
import { filterExecutionAuditEvents } from './executionAudit'
import { buildExecutionTimeline, executionTimelineOverview } from './executionTimeline'

it('shows a recovered host integration after an earlier apply failure', () => {
  const events: HarnessEvent[] = [
    { id: 'failed', session_id: 's', timestamp: '2026-10-01T11:59:28Z', type: 'host.apply_failed', data: { error: 'index.lock exists' } },
    { id: 'settled', session_id: 's', timestamp: '2026-10-01T12:00:20Z', type: 'host.apply_settled', data: { state: 'applied', applied_changes: 1 } },
  ]
  const entries = buildExecutionTimeline(filterExecutionAuditEvents(events))
  expect(entries.map((entry) => entry.id)).toEqual(['failed', 'settled'])
  expect(entries[0].lifecycleState).toBe('failure')
  expect(entries[1].lifecycleState).toBe('success')
  expect(executionTimelineOverview(entries)).toBe('recovered')
})

import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { executionNeedsAttention } from './executionRecovery'

function session(status: NonNullable<Session['interrupted_execution']>['status']): Session {
  return {
    id: 'ses-1', project_path: '/workspace/wharnex', state: 'planned', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-08T18:20:00.000Z',
    context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharnex', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
    interrupted_execution: { plan_id: 'plan-1', requested_at: '2026-09-08T18:20:00.000Z', approved: false, status },
  }
}

describe('execution recovery visibility', () => {
  it('does not turn a live execution into an interrupted-execution notification', () => {
    expect(executionNeedsAttention(session('running'))).toBe(false)
  })

  it('keeps genuinely interrupted and retryable executions visible', () => {
    expect(executionNeedsAttention(session(undefined))).toBe(true)
    expect(executionNeedsAttention(session('awaiting_decision'))).toBe(true)
    expect(executionNeedsAttention(session('resuming'))).toBe(true)
    expect(executionNeedsAttention(session('failed_retryable'))).toBe(true)
  })
})

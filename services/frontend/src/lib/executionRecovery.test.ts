import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { executionNeedsAttention, sessionNeedsExecutionConsent } from './executionRecovery'

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

  it('asks once for an enriched protected root plan but not a repair descendant', () => {
    const current = session('running')
    current.interrupted_execution = undefined
    current.plan = { protocol: 'harness.execution/v1', plan_id: 'plan-1', request_id: 'req-root', status: 'ready', summary: 'Change', document: '# Execution contract', risk: 'low', requires_approval: false, operations: [], verification: [] }
    current.request_lineages = { 'req-root': { request_id: 'req-root', root_request_id: 'req-root', kind: 'standard', created_at: '2026-09-08T18:20:00.000Z' } }
    expect(sessionNeedsExecutionConsent(current)).toBe(true)

    current.plan = { ...current.plan, request_id: 'req-repair' }
    current.request_lineages['req-repair'] = { request_id: 'req-repair', root_request_id: 'req-root', parent_request_id: 'req-root', kind: 'repair', created_at: '2026-09-08T18:21:00.000Z' }
    expect(sessionNeedsExecutionConsent(current)).toBe(false)
  })

  it('lets Full waive only approval items explicitly marked bypassable', () => {
    const current = session('running')
    current.interrupted_execution = undefined
    current.execution_mode = 'full'
    current.plan = { protocol: 'harness.execution/v1', plan_id: 'plan-full', request_id: 'req-full', status: 'ready', summary: 'Full', risk: 'high', requires_approval: true, operations: [], verification: [] }
    current.policy = {
      allowed: true, requires_approval: true, risk: 'high', reasons: ['command approval'],
      approval_items: [{ kind: 'command', argv: ['sh', '-n', 'script.sh'], rationale: 'Validate shell syntax', effect: 'Reads script syntax', host_impact: 'No persistent host change', bypass_in_full: true }],
    }
    expect(sessionNeedsExecutionConsent(current)).toBe(false)
  })

  it('keeps sudo approval non-bypassable in Full', () => {
    const current = session('running')
    current.interrupted_execution = undefined
    current.execution_mode = 'full'
    current.plan = { protocol: 'harness.execution/v1', plan_id: 'plan-sudo', request_id: 'req-sudo', status: 'ready', summary: 'Sudo', risk: 'high', requires_approval: true, operations: [], verification: [] }
    current.policy = {
      allowed: true, requires_approval: true, risk: 'high', reasons: ['sudo approval'],
      approval_items: [{ kind: 'sudo', argv: ['sudo', 'systemctl', 'restart', 'example'], rationale: 'Restart service', effect: 'Restarts example', host_impact: 'Changes host service state', requires_sudo_password: true, bypass_in_full: false }],
    }
    expect(sessionNeedsExecutionConsent(current)).toBe(true)
  })

})

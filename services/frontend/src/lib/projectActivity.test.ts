import { describe, expect, it } from 'vitest'
import type { ExecutionPlan, ExecutionResult, HarnessEvent, Session } from '../types'
import type { WorkspaceChat } from './workspaceMemory'
import { collectExecutionActivities, collectPlanActivities, executionAuditEvents, executionEventsFromResult, filterAuditEvents, loadProjectSessions } from './projectActivity'

const plan = (id: string, summary = id): ExecutionPlan => ({
  protocol: 'harness.execution/v1', plan_id: id, request_id: `req-${id}`, status: 'ready', summary,
  risk: 'low', requires_approval: false, operations: [], verification: [],
})
const execution = (id: string, started = '2026-09-05T10:00:00.000Z'): ExecutionResult => ({
  plan_id: id, success: true, started_at: started, completed_at: '2026-09-05T10:00:02.000Z', commands: [{
    argv: ['go', 'test', './...'], cwd: '.', exit_code: 0, stdout: 'ok\n', stderr: '', duration_ms: 1200, success: true,
  }],
})
const chat = (id: string): WorkspaceChat => ({ id, title: `Chat ${id}`, sessionId: `ses-${id}`, createdAt: '2026-09-05T09:00:00.000Z', updatedAt: '2026-09-05T09:00:00.000Z' })
const session = (id: string): Session => ({
  id: `ses-${id}`, project_path: '/workspace/wharness', state: 'verified', execution_mode: 'protected', automation_mode: 'auto', created_at: '2026-09-05T09:00:00.000Z',
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/wharness', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
})

describe('durable plan and execution ledger', () => {
  const recorded = (type: string, body: Record<string, unknown>, timestamp: string): HarnessEvent => ({
    id: `evt-${type}-${timestamp}`, session_id: 'ses-a', type, timestamp, data: body,
  })

  // The session snapshot keeps one current plan and one last execution and
  // several lifecycle transitions clear both, which is why the views appeared
  // to reset. The ledger is the record that actually survives.
  it('rebuilds every execution round from the ledger, not only the session snapshot', () => {
    const value = session('a')
    // The snapshot holds the same run the ledger's newest record does, which is
    // how it arrives in practice; it must appear once, not twice.
    value.last_execution = execution('p3', '2026-09-05T10:10:00.000Z')
    const ledger = {
      a: [
        recorded('execution.recorded', { plan_id: 'p1', request_id: 'req-1', execution: execution('p1', '2026-09-05T10:00:00.000Z') }, '2026-09-05T10:00:00.000Z'),
        recorded('execution.recorded', { plan_id: 'p2', request_id: 'req-1', execution: execution('p2', '2026-09-05T10:05:00.000Z') }, '2026-09-05T10:05:00.000Z'),
        recorded('execution.recorded', { plan_id: 'p3', request_id: 'req-1', execution: execution('p3', '2026-09-05T10:10:00.000Z') }, '2026-09-05T10:10:00.000Z'),
      ],
    }
    const items = collectExecutionActivities([{ chat: chat('a'), session: value }], ledger)
    expect(items.map((item) => item.execution.plan_id)).toEqual(['p3', 'p2', 'p1'])
    expect(items[2].requestId).toBe('req-1')
  })

  it('rebuilds plans from the ledger and lets a live snapshot entry keep its richer label', () => {
    const value = session('a')
    value.last_applied_changes = [{ plan: plan('p1', 'Plano aplicado'), execution: execution('p1'), verified_at: '2026-09-05T10:02:00.000Z' }]
    const ledger = {
      a: [
        recorded('plan.recorded', { plan_id: 'p0', request_id: 'req-0', plan: plan('p0', 'Plano descartado') }, '2026-09-05T09:50:00.000Z'),
        recorded('plan.recorded', { plan_id: 'p1', request_id: 'req-1', plan: plan('p1', 'Plano aplicado') }, '2026-09-05T10:00:00.000Z'),
      ],
    }
    const items = collectPlanActivities([{ chat: chat('a'), session: value }], ledger)
    expect(items.map((item) => item.plan.plan_id)).toEqual(['p1', 'p0'])
    expect(items[0].label).toBe('Aplicado no host')
    expect(items[1].label).toBe('Registado')
  })

  it('ignores ledger records that carry no usable body', () => {
    const ledger = {
      a: [
        recorded('execution.recorded', { plan_id: '', request_id: 'req-1' }, '2026-09-05T10:00:00.000Z'),
        recorded('plan.recorded', { plan_id: 'p1' }, '2026-09-05T10:00:00.000Z'),
      ],
    }
    expect(collectExecutionActivities([{ chat: chat('a'), session: session('a') }], ledger)).toHaveLength(0)
    expect(collectPlanActivities([{ chat: chat('a'), session: session('a') }], ledger)).toHaveLength(0)
  })
})

describe('project activity catalogue', () => {
  it('collects current, pending and applied plans without duplicating the same chat plan', () => {
    const value = session('a')
    value.plan = plan('p1', 'Plano atual')
    value.last_execution = execution('p1')
    value.pending_host_changes = [{ plan: plan('p1', 'Plano atual'), execution: execution('p1'), verified_at: '2026-09-05T10:01:00.000Z' }]
    value.last_applied_changes = [{ plan: plan('p2', 'Plano anterior'), execution: execution('p2', '2026-09-04T10:00:00.000Z'), verified_at: '2026-09-04T10:02:00.000Z' }]
    const items = collectPlanActivities([{ chat: chat('a'), session: value }])
    expect(items.map((item) => item.plan.plan_id)).toEqual(['p1', 'p2'])
    expect(items[0].label).toContain('pendente')
  })

  it('collects execution results and reconstructs command output for the execution detail view', () => {
    const value = session('a')
    value.last_execution = execution('p1')
    const items = collectExecutionActivities([{ chat: chat('a'), session: value }])
    expect(items).toHaveLength(1)
    const events = executionEventsFromResult(items[0].execution, value.id)
    expect(events.map((event) => event.type)).toEqual(['execution.started', 'command.started', 'command.completed', 'execution.completed'])
    expect(events[2].data.stdout).toBe('ok\n')
    expect(events[2].data.exit_code).toBe(0)
  })

  it('uses durable audit events for the selected execution and keeps unrelated requests out', () => {
    const value = session('a')
    value.plan = plan('p1', 'Plano atual')
    value.last_execution = execution('p1')
    const item = collectExecutionActivities([{ chat: chat('a'), session: value }])[0]
    const events: HarnessEvent[] = [
      { id: 'a', session_id: value.id, type: 'execution.started', timestamp: '2026-09-05T10:00:00Z', data: { plan_id: 'p1', request_id: 'req-p1' } },
      { id: 'b', session_id: value.id, type: 'host.applied', timestamp: '2026-09-05T10:03:00Z', data: { plan_id: 'p1' } },
      { id: 'c', session_id: value.id, type: 'execution.failed', timestamp: '2026-09-05T11:00:00Z', data: { plan_id: 'other', request_id: 'req-other', error: 'nope' } },
    ]
    const scoped = executionAuditEvents(events, item)
    expect(scoped.map((event) => event.id)).toEqual(['a', 'b'])
    expect(filterAuditEvents(events, 'NOPE').map((event) => event.id)).toEqual(['c'])
  })

  it('bounds parallel session loads so project history cannot exhaust browser request resources', async () => {
    let inFlight = 0
    let peak = 0
    const loadSession = async (id: string) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 2))
      inFlight--
      if (id === 'ses-missing') throw new Error('stale session')
      return session(id.replace(/^ses-/, ''))
    }
    const result = await loadProjectSessions(['ses-a', 'ses-b', 'ses-c', 'ses-d', 'ses-e', 'ses-missing'], loadSession, 2)
    expect(peak).toBeLessThanOrEqual(2)
    expect(result.failed).toBe(1)
    expect(Object.keys(result.sessions)).toHaveLength(5)
  })

})

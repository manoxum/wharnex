import { describe, expect, it } from 'vitest'
import type { ExecutionPlan, ExecutionResult, Session } from '../types'
import type { WorkspaceChat } from './workspaceMemory'
import { collectExecutionActivities, collectPlanActivities, executionEventsFromResult, loadProjectSessions } from './projectActivity'

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

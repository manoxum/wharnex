import { describe, expect, it } from 'vitest'
import type { ExecutionPlan, ExecutionResult, HarnessEvent } from '../../../types'
import { buildExecutionTimeline } from '../history/executionTimeline'
import { filterExecutionAuditEvents } from '../history/executionAudit'
import { projectExecutionEvidence } from './projectExecutionEvidence'

const start = '2026-10-09T08:00:00Z'
const end = '2026-10-09T08:00:02Z'
const plan: ExecutionPlan = { protocol: 'harness.execution/v2', plan_id: 'plan-observe', request_id: 'req-observe', summary: 'Extrair dados', risk: 'low', status: 'ready', requires_approval: true, operations: [], verification: [], debug: { protocol: 'harness.interactive/v2', target: 'host', access: 'observe', rationale: 'Diagnóstico' } }
const command = { argv: ['docker', 'exec', 'app', 'node', 'probe.js'], cwd: '.', exit_code: 1, success: false, stdout: 'catalogue\n', stderr: 'P2010\n', duration_ms: 2000 }
const execution: ExecutionResult = { plan_id: plan.plan_id, started_at: start, completed_at: end, success: false, commands: [command], error: 'Probe falhou' }
const event = (id: string, type: string, timestamp: string, data: HarnessEvent['data']): HarnessEvent => ({ id, type, timestamp, data, session_id: 'ses-observe' })
const ledger = (body = execution) => event('ledger', 'execution.recorded', end, { execution: body, plan_id: plan.plan_id, request_id: plan.plan_id, success: body.success })
const planEvent = event('plan', 'plan.recorded', '2026-10-09T07:59:00Z', { plan, plan_id: plan.plan_id, request_id: plan.request_id })

describe('durable extraction evidence', () => {
  it('restores argv, both streams and failure after live events expire and snapshot clears', () => {
    const projected = projectExecutionEvidence([planEvent, ledger()])
    const entries = buildExecutionTimeline(filterExecutionAuditEvents(projected))
    const commands = entries.filter((entry) => entry.kind === 'command')
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ title: 'docker exec app node probe.js', badge: 'exit 1', tone: 'fail', durationMs: 2000, requestId: plan.request_id, iterationKind: 'evidence' })
    expect(commands[0].outputSegments).toEqual([{ stream: 'stdout', text: 'catalogue' }, { stream: 'stderr', text: 'P2010' }])
    expect(projectExecutionEvidence(projected)).toEqual(projected)
  })

  it('reconciles a running streamed command with ledger result without duplicating it', () => {
    const events = [planEvent, event('begin', 'workflow.started', start, { plan_id: plan.plan_id, request_id: plan.request_id }), event('cmd', 'command.started', start, { run_id: 'run-1', argv: command.argv, cwd: '.' }), event('partial', 'command.output', start, { run_id: 'run-1', text: 'cat', stream: 'stdout' }), ledger()]
    const commands = buildExecutionTimeline(filterExecutionAuditEvents(projectExecutionEvidence(events))).filter((entry) => entry.kind === 'command')
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ id: 'run-1', running: false, output: 'catalogue\nP2010' })
  })

  it('reconciles timestamps with differing RFC3339 precision', () => {
    const events = [planEvent, event('cmd', 'command.completed', '2026-10-09T08:00:00.500Z', { plan_id: plan.plan_id, run_id: 'fractional', ...command }), ledger()]
    const commands = buildExecutionTimeline(filterExecutionAuditEvents(projectExecutionEvidence(events))).filter((entry) => entry.kind === 'command')
    expect(commands).toHaveLength(1)
    expect(commands[0].id).toBe('fractional')
  })

  it('preserves repeated identical commands as separate executions', () => {
    const body = { ...execution, commands: [command, { ...command, stdout: 'second result' }] }
    const commands = buildExecutionTimeline(filterExecutionAuditEvents(projectExecutionEvidence([planEvent, ledger(body)]))).filter((entry) => entry.kind === 'command')
    expect(commands).toHaveLength(2)
    expect(commands[1].output).toContain('second result')
  })

  it('shows typed operation outputs and marks truncation/redaction without reading environment', () => {
    const body: ExecutionResult = { ...execution, commands: [], interactive: [{ operation_id: 'op-sql', type: 'sql', capability: 'sql', target: 'host', status: 'failed', started_at: start, completed_at: end, output: 'rows=[]; password=[REDACTED]', error: 'SQLSTATE42P10', redacted: true, truncated: true }] }
    const entries = buildExecutionTimeline(filterExecutionAuditEvents(projectExecutionEvidence([planEvent, ledger(body)])))
    expect(entries.find((entry) => entry.id === 'op-sql')).toMatchObject({ title: 'Operação sql', running: false, tone: 'fail', durationMs: 2000, detail: 'host · saída limitada · segredos ocultos' })
    expect(entries.find((entry) => entry.id === 'op-sql')?.output).toContain('SQLSTATE42P10')
  })

  it('keeps terminal and human PTY output outside the Agent projection', () => {
    expect(filterExecutionAuditEvents([event('pty', 'terminal.command_output', end, { text: 'human shell' })])).toEqual([])
  })
})

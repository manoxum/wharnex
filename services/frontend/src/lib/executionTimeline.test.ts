import { expect, it } from 'vitest'
import { buildExecutionTimeline } from './executionTimeline'
import type { HarnessEvent } from '../types'

it('groups one command with all of its streamed output and duration', () => {
  const event = (id: string, type: string, data: Record<string, unknown>): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-04T06:00:00Z', data })
  const entries = buildExecutionTimeline([
    event('1', 'command.started', { run_id: 'r', argv: ['go', 'test', './...'], cwd: '.', target: 'sandbox' }),
    event('2', 'command.output', { run_id: 'r', stream: 'stdout', text: 'one\n' }),
    event('3', 'command.output', { run_id: 'r', stream: 'stderr', text: 'two\n' }),
    event('4', 'command.completed', { run_id: 'r', argv: ['go', 'test', './...'], exit_code: 0, success: true, duration_ms: 321 }),
  ])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ id: 'r', running: false, durationMs: 321, badge: 'exit 0' })
  expect(entries[0].output).toContain('[stdout] one')
  expect(entries[0].output).toContain('[stderr] two')
})

it('streams a self-evolution host build live instead of only reporting it after completion', () => {
  const event = (id: string, type: string, data: Record<string, unknown>): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-07T00:44:00Z', data })
  const entries = buildExecutionTimeline([
    event('1', 'self_evolution.host_build_started', { plan_id: 'plan-1', transaction_id: 'txn-1' }),
    event('2', 'self_evolution.host_build_output', { transaction_id: 'txn-1', stream: 'stdout', text: '[deps] frontend: running npm ci\n' }),
    event('3', 'self_evolution.host_build_output', { transaction_id: 'txn-1', stream: 'stderr', text: 'npm warn EBADENGINE\n' }),
    event('4', 'self_evolution.host_build_completed', { plan_id: 'plan-1', transaction_id: 'txn-1' }),
  ])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ id: 'txn-1', kind: 'command', title: 'Build do Wharness concluído', badge: 'OK', tone: 'ok', running: false })
  expect(entries[0].output).toContain('[stdout] [deps] frontend: running npm ci')
  expect(entries[0].output).toContain('[stderr] npm warn EBADENGINE')
})

it('marks a self-evolution host build failed while keeping whatever output already streamed', () => {
  const event = (id: string, type: string, data: Record<string, unknown>): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-07T00:44:00Z', data })
  const entries = buildExecutionTimeline([
    event('1', 'self_evolution.host_build_started', { plan_id: 'plan-1', transaction_id: 'txn-2' }),
    event('2', 'self_evolution.host_build_output', { transaction_id: 'txn-2', stream: 'stderr', text: 'ERR_REQUIRE_ESM\n' }),
    event('3', 'self_evolution.host_build_failed', { plan_id: 'plan-1', transaction_id: 'txn-2', error: 'self-evolution host build failed' }),
  ])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ id: 'txn-2', running: false, badge: 'FAIL', tone: 'fail' })
  expect(entries[0].output).toContain('ERR_REQUIRE_ESM')
})

it('renders duplicate execution protection as a warning status', () => {
  const entries = buildExecutionTimeline([{
    id: 'evt-duplicate', session_id: 'ses-1', type: 'execution.duplicate_blocked', timestamp: '2026-09-04T18:00:00Z',
    data: { plan_id: 'plan-done', state: 'applied' },
  }])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ title: 'Reexecução bloqueada', badge: 'DONE', tone: 'warning' })
  expect(entries[0].detail).toContain('plan-done')
})

it('groups standard, repair, and evidence iterations under their main request', () => {
  const event = (id: string, type: string, data: Record<string, unknown>): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-04T06:00:00Z', data })
  const entries = buildExecutionTimeline([
    event('1', 'execution.started', { request_id: 'req-main', root_request_id: 'req-main', iteration_kind: 'standard', plan_id: 'p1' }),
    event('2', 'execution.failed', { request_id: 'req-main', root_request_id: 'req-main', iteration_kind: 'standard', error: 'failed' }),
    event('3', 'repair.started', { request_id: 'req-repair', root_request_id: 'req-main', iteration_kind: 'repair' }),
    event('4', 'workflow.started', { request_id: 'req-evidence', root_request_id: 'req-main', iteration_kind: 'evidence' }),
  ])
  expect(entries.map((entry) => [entry.rootRequestId, entry.iterationKind])).toEqual([
    ['req-main', 'standard'], ['req-main', 'standard'], ['req-main', 'repair'], ['req-main', 'evidence'],
  ])
})

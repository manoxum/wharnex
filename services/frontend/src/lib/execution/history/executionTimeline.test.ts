import { expect, it } from 'vitest'
import { buildExecutionTimeline, executionTimelineOverview, groupExecutionSubtasks } from './executionTimeline'
import type { HarnessEvent } from '../../../types'

it('groups one command with all of its streamed output and duration', () => {
  const event = (id: string, type: string, data: Record<string, unknown>): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-04T06:00:00Z', data })
  const entries = buildExecutionTimeline([
    event('1', 'command.started', { run_id: 'r', argv: ['go', 'test', './...'], cwd: '.', target: 'sandbox', rationale: 'Confirmar que os testes afetados continuam a passar.' }),
    event('2', 'command.output', { run_id: 'r', stream: 'stdout', text: 'one\n' }),
    event('3', 'command.output', { run_id: 'r', stream: 'stderr', text: 'two\n' }),
    event('4', 'command.completed', { run_id: 'r', argv: ['go', 'test', './...'], exit_code: 0, success: true, duration_ms: 321 }),
  ])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ id: 'r', running: false, durationMs: 321, badge: 'exit 0', rationale: 'Confirmar que os testes afetados continuam a passar.' })
  expect(entries[0].output).toBe('one\ntwo\n')
  expect(entries[0].output).not.toContain('[stdout]')
  expect(entries[0].output).not.toContain('[stderr]')
  expect(entries[0].outputSegments).toEqual([
    { stream: 'stdout', text: 'one\n' },
    { stream: 'stderr', text: 'two\n' },
  ])
})

it('keeps stdout and stderr semantics when only completion output is available', () => {
  const event = (id: string, type: string, data: Record<string, unknown>): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-04T06:00:00Z', data })
  const entries = buildExecutionTimeline([
    event('1', 'command.completed', { run_id: 'fallback', argv: ['go', 'test'], exit_code: 1, success: false, stdout: 'ordinary output', stderr: 'failure detail' }),
  ])
  expect(entries[0].output).toBe('ordinary output\nfailure detail')
  expect(entries[0].outputSegments).toEqual([
    { stream: 'stdout', text: 'ordinary output' },
    { stream: 'stderr', text: 'failure detail' },
  ])
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
  expect(entries[0]).toMatchObject({ id: 'txn-1', kind: 'command', title: 'Build do Wharnex concluído', badge: 'OK', tone: 'ok', running: false })
  expect(entries[0].output).toContain('[deps] frontend: running npm ci')
  expect(entries[0].output).toContain('npm warn EBADENGINE')
  expect(entries[0].output).not.toContain('[stdout]')
  expect(entries[0].output).not.toContain('[stderr]')
  expect(entries[0].outputSegments.map((segment) => segment.stream)).toEqual(['stdout', 'stderr'])
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

it('keeps Interactive v2 operation purpose and output inspectable', () => {
  const event = (id: string, type: string, data: Record<string, unknown>): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-18T04:00:00Z', data })
  const entries = buildExecutionTimeline([
    event('op-1', 'interactive.operation_completed', { operation_id: 'op-01', capability: 'sql', status: 'completed', output: '2 rows', rationale: 'Confirmar o estado persistido antes de continuar.' }),
  ])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ rationale: 'Confirmar o estado persistido antes de continuar.' })
  expect(entries[0].output).toContain('2 rows')
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


it('groups execution history into expandable subtasks by request and iteration', () => {
  const event = (id: string, type: string, data: Record<string, unknown>, timestamp: string): HarnessEvent => ({ id, session_id: 's', type, timestamp, data })
  const entries = buildExecutionTimeline([
    event('1', 'execution.started', { request_id: 'req-main', root_request_id: 'req-main', iteration_kind: 'standard' }, '2026-09-04T06:00:00Z'),
    event('2', 'command.completed', { run_id: 'main-command', argv: ['npm', 'test'], exit_code: 1, success: false }, '2026-09-04T06:01:00Z'),
    event('3', 'repair.started', { request_id: 'req-repair', root_request_id: 'req-main', iteration_kind: 'repair' }, '2026-09-04T06:02:00Z'),
    event('4', 'execution.completed', { request_id: 'req-repair', root_request_id: 'req-main', iteration_kind: 'repair' }, '2026-09-04T06:03:00Z'),
  ])
  const groups = groupExecutionSubtasks(entries)

  expect(groups).toHaveLength(2)
  expect(groups.map((group) => [group.requestId, group.iterationKind, group.entries.length])).toEqual([
    ['req-main', 'standard', 2],
    ['req-repair', 'repair', 2],
  ])
  expect(groups[1].overview).toBe('success')
  expect(groups[1].updatedAt).toBe('2026-09-04T06:03:00Z')
})

it('keeps generic audit events inspectable with structured payload and severity', () => {
  const entries = buildExecutionTimeline([{
    id: 'evt-raw', session_id: 's', type: 'transport.failed', timestamp: '2026-09-04T06:00:00Z',
    data: { request_id: 'req-main', transport: 'desktop', error: 'upload timeout', attempt: 2 },
  }])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ title: 'transport.failed', badge: 'EVENT', tone: 'fail' })
  expect(entries[0].detail).toContain('request_id=req-main')
  expect(entries[0].output).toContain('[erro] upload timeout')
  expect(entries[0].output).toContain('"attempt": 2')
})

it('reports recovery after a blocked execution is repaired and applied on the host', () => {
  const event = (id: string, type: string, data: Record<string, unknown>): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-18T12:00:00Z', data })
  const entries = buildExecutionTimeline([
    event('1', 'automation.policy_blocked', { request_id: 'req-main', root_request_id: 'req-main' }),
    event('2', 'repair.started', { request_id: 'req-repair', root_request_id: 'req-main', iteration_kind: 'repair', attempt: 1 }),
    event('3', 'execution.started', { request_id: 'req-repair', root_request_id: 'req-main', target: 'sandbox' }),
    event('4', 'execution.completed', { request_id: 'req-repair', root_request_id: 'req-main', target: 'sandbox' }),
    event('5', 'host.apply_started', { request_id: 'req-repair', root_request_id: 'req-main', patch_count: 1 }),
    event('6', 'host.applied', { request_id: 'req-repair', root_request_id: 'req-main' }),
  ])
  expect(entries[0]).toMatchObject({ tone: 'fail', lifecycleState: 'failure' })
  expect(executionTimelineOverview(entries)).toBe('recovered')
})

it('uses the latest terminal lifecycle result instead of any historical failure', () => {
  const event = (id: string, type: string): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-18T12:00:00Z', data: {} })
  expect(executionTimelineOverview(buildExecutionTimeline([
    event('1', 'host.applied'),
    event('2', 'host.apply_failed'),
  ]))).toBe('failed')
  expect(executionTimelineOverview(buildExecutionTimeline([
    event('1', 'execution.failed'),
    event('2', 'execution.started'),
  ]))).toBe('active')
})

it('renders auto-approval as explicit audit evidence', () => {
  const entries = buildExecutionTimeline([{
    id: 'evt-auto-approval', session_id: 'ses-1', type: 'automation.approval_auto_granted', timestamp: '2026-09-20T05:00:00Z',
    data: { plan_id: 'plan-auto', risk: 'medium', transport: 'provider' },
  }])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ title: 'Aprovação automática', badge: 'AUTO', tone: 'ok', detail: 'medium' })
})

it('settles repair activity to waiting when its continuation prompt is ready', () => {
  const event = (id: string, type: string, data: Record<string, unknown>): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-22T08:00:00Z', data })
  const entries = buildExecutionTimeline([
    event('1', 'repair.started', { request_id: 'req-repair', root_request_id: 'req-main', iteration_kind: 'repair', attempt: 1 }),
    event('2', 'repair.prompt_ready', { request_id: 'req-repair', root_request_id: 'req-main', iteration_kind: 'repair' }),
  ])

  expect(entries[1]).toMatchObject({ badge: 'READY', lifecycleState: 'waiting' })
  expect(executionTimelineOverview(entries)).toBe('waiting')
})

it('marks approval and queue boundaries as waiting until execution actually starts', () => {
  const event = (id: string, type: string): HarnessEvent => ({ id, session_id: 's', type, timestamp: '2026-09-22T08:00:00Z', data: { request_id: 'req-main', root_request_id: 'req-main' } })
  expect(executionTimelineOverview(buildExecutionTimeline([event('1', 'execution.queued')]))).toBe('waiting')
  expect(executionTimelineOverview(buildExecutionTimeline([event('1', 'automation.approval_required')]))).toBe('waiting')
  expect(executionTimelineOverview(buildExecutionTimeline([event('1', 'execution.dequeued'), event('2', 'execution.started')]))).toBe('active')
})

import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { HarnessEvent, Session } from '../../../types'
import { ExecutionHistorySurface } from './ExecutionHistorySurface'

afterEach(cleanup)
const current: Session = { id: 'ses', project_path: '/workspace/app', state: 'workflow_pending', execution_mode: 'protected', automation_mode: 'auto', created_at: '', context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/workspace/app', sha256: 'abc', files: [], excluded: [], text_truncated: false } }, last_request_id: 'req-next', request_lineages: { 'req-probe': { request_id: 'req-probe', root_request_id: 'req-root', kind: 'evidence', created_at: '' }, 'req-next': { request_id: 'req-next', root_request_id: 'req-root', kind: 'evidence', created_at: '' } } }
const event = (id: string, type: string, timestamp: string, data: HarnessEvent['data']): HarnessEvent => ({ id, session_id: 'ses', type, timestamp, data })

it('renders every recorded extraction command and both outputs after workflow advances', async () => {
  const commands = Array.from({ length: 6 }, (_, i) => ({ argv: ['probe', `case ${i}`], cwd: '.', stdout: `stdout ${i}`, stderr: `stderr ${i}`, duration_ms: 10, exit_code: i === 5 ? 1 : 0, success: i !== 5 }))
  const events = [event('record', 'execution.recorded', '2026-10-09T01:00:02Z', { request_id: 'req-probe', iteration_kind: 'evidence', execution: { plan_id: 'plan-probe', started_at: '2026-10-09T01:00:00Z', completed_at: '2026-10-09T01:00:02Z', commands, success: false }, success: false })]
  render(<ExecutionHistorySurface session={current} events={events} loading={false} error=""/>)
  await waitFor(() => expect(screen.getAllByLabelText('argv exato')).toHaveLength(6))
  for (let i = 0; i < 6; i++) { expect(screen.getByText(`stdout ${i}`)).toBeTruthy(); expect(screen.getByText(`stderr ${i}`)).toBeTruthy() }
  expect(screen.getByText('Extração de informações')).toBeTruthy()
  expect(screen.getByText('exit 1')).toBeTruthy()
})

it('reveals a live command output arriving after an empty initial render', async () => {
  const begin = event('begin', 'workflow.started', '2026-10-09T01:00:00Z', { plan_id: 'plan-probe', request_id: 'req-probe', iteration_kind: 'evidence' })
  const view = render(<ExecutionHistorySurface session={current} events={[begin]} loading={false} error=""/>)
  view.rerender(<ExecutionHistorySurface session={current} events={[begin, event('cmd', 'command.started', '2026-10-09T01:00:01Z', { run_id: 'run-live', argv: ['go', 'env', 'GOVERSION'], request_id: 'req-probe' }), event('out', 'command.output', '2026-10-09T01:00:02Z', { run_id: 'run-live', text: 'go1.24.0', stream: 'stdout', request_id: 'req-probe' })]} loading={false} error=""/>)
  await waitFor(() => expect(screen.getByText('go1.24.0')).toBeTruthy())
})

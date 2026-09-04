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

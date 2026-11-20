import { expect, it } from 'vitest'
import type { HarnessEvent } from '../../../../../types'
import { buildExecutionTimeline } from '../../../../../lib/execution/history/executionTimeline'
import { EMPTY_OUTPUT_FILTER, matchesOutput, outputLevel } from './outputFilter'

const events: HarnessEvent[] = [
  { id: 'start', session_id: 's', type: 'command.started', timestamp: '2026-10-16T14:00:00Z', data: { run_id: 'run', argv: ['npm', 'test'] } },
  { id: 'output', session_id: 's', type: 'command.output', timestamp: '2026-10-16T14:00:01Z', data: { run_id: 'run', stream: 'stderr', text: 'Build failed' } },
  { id: 'done', session_id: 's', type: 'command.completed', timestamp: '2026-10-16T14:00:02Z', data: { run_id: 'run', exit_code: 1, success: false } },
]
const [entry] = buildExecutionTimeline(events)

it('filters execution rows by source, semantic level, date and visible output text', () => {
  const before = JSON.stringify(events)
  expect(matchesOutput(entry, { text: 'build', source: 'command', level: 'error', date: '2026-10-16' })).toBe(true)
  expect(matchesOutput(entry, { ...EMPTY_OUTPUT_FILTER, level: 'info' })).toBe(false)
  expect(matchesOutput(entry, { ...EMPTY_OUTPUT_FILTER, date: '2026-10-15' })).toBe(false)
  expect(outputLevel(entry)).toBe('error')
  expect(JSON.stringify(events)).toBe(before)
})

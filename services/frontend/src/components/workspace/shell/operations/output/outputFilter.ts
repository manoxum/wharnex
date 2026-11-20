import type { ExecutionTimelineEntry } from '../../../../../lib/execution/history/executionTimeline'

export type OutputFilter = { text: string; source: string; level: string; date: string }
export const EMPTY_OUTPUT_FILTER: OutputFilter = { text: '', source: '', level: '', date: '' }

export function outputSource(entry: ExecutionTimelineEntry) {
  return entry.kind === 'command' ? 'command' : entry.kind === 'patch' ? 'patch' : 'event'
}

export function outputLevel(entry: ExecutionTimelineEntry) {
  if (entry.tone === 'fail' || entry.outputSegments.some((segment) => segment.stream === 'stderr')) return 'error'
  if (entry.tone === 'warning' || entry.running) return 'warning'
  return 'info'
}

export function matchesOutput(entry: ExecutionTimelineEntry, filter: OutputFilter) {
  const text = [entry.title, entry.detail, entry.badge, entry.rationale, entry.requestId, entry.rootRequestId, entry.argv?.join(' '), entry.outputSegments.map((segment) => segment.text).join(' ')].filter(Boolean).join(' ').toLocaleLowerCase()
  return (!filter.source || outputSource(entry) === filter.source) && (!filter.level || outputLevel(entry) === filter.level) && (!filter.date || entry.timestamp.slice(0, 10) === filter.date) && (!filter.text || text.includes(filter.text.trim().toLocaleLowerCase()))
}

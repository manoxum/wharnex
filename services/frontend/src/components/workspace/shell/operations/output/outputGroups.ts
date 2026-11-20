import type { ExecutionTimelineEntry } from '../../../../../lib/execution/history/executionTimeline'

export type OutputGroup = {
  id: string
  requestId: string
  entries: ExecutionTimelineEntry[]
  errors: number
  commands: number
  durationMs: number
}

/** Keep timeline order. Only adjacent entries with a real request ID share a group. */
export function groupOutputEntries(entries: ExecutionTimelineEntry[]): OutputGroup[] {
  const groups: OutputGroup[] = []
  for (const entry of entries) {
    const previous = groups.at(-1)
    const requestId = entry.requestId.trim()
    const group = requestId && previous?.requestId === requestId ? previous : undefined
    if (group) {
      group.entries.push(entry)
      group.errors += entry.tone === 'fail' ? 1 : 0
      group.commands += entry.kind === 'command' ? 1 : 0
      group.durationMs += entry.durationMs || 0
    } else {
      groups.push({
        id: `${entry.id}:${groups.length}`,
        requestId,
        entries: [entry],
        errors: entry.tone === 'fail' ? 1 : 0,
        commands: entry.kind === 'command' ? 1 : 0,
        durationMs: entry.durationMs || 0,
      })
    }
  }
  return groups
}

import type { HarnessEvent } from '../../../types'
import type { ExecutionTimelineEntry } from '../history/executionTimeline'
import { setFallbackOutput } from './timelineOutput'

export function projectInteractiveEntry(event: HarnessEvent, lineage: Pick<ExecutionTimelineEntry, 'requestId' | 'rootRequestId' | 'iterationKind'>, entries: ExecutionTimelineEntry[], grouped: Map<string, ExecutionTimelineEntry>) {
  if (!['interactive.operation_started', 'interactive.operation_completed'].includes(event.type)) return false
  const id = String(event.data.operation_id || event.id)
  let entry = grouped.get(id)
  if (!entry) {
    entry = { id, kind: 'command', title: `Operação ${String(event.data.capability || event.data.type || 'interativa')}`, detail: String(event.data.target || ''), badge: 'RUN', tone: 'warning', timestamp: event.timestamp, running: true, output: '', outputSegments: [], rationale: String(event.data.rationale || ''), ...lineage, iterationKind: 'evidence' }
    entries.push(entry); grouped.set(id, entry)
  }
  if (event.type === 'interactive.operation_completed') {
    entry.running = false
    entry.badge = String(event.data.status || 'concluída')
    entry.tone = event.data.status === 'failed' || event.data.error ? 'fail' : 'ok'
    entry.lifecycleState = entry.tone === 'fail' ? 'failure' : 'success'
    entry.detail = [entry.detail, event.data.truncated ? 'saída limitada' : '', event.data.redacted ? 'segredos ocultos' : ''].filter(Boolean).join(' · ')
    setFallbackOutput(entry, event)
    const started = Date.parse(String(event.data.started_at || entry.timestamp))
    const completed = Date.parse(String(event.data.completed_at || event.timestamp))
    if (Number.isFinite(started) && Number.isFinite(completed)) entry.durationMs = Math.max(0, completed - started)
  }
  return true
}

import type { HarnessEvent } from '../../../types'
import type { ExecutionOutputSegment, ExecutionTimelineEntry } from '../history/executionTimeline'

export function appendOutput(entry: ExecutionTimelineEntry, stream: 'stdout' | 'stderr', text: string) {
  entry.output += text
  const previous = entry.outputSegments.at(-1)
  if (previous?.stream === stream) previous.text += text
  else entry.outputSegments.push({ stream, text })
}

function fallbackOutput(event: HarnessEvent): ExecutionOutputSegment[] {
  const segments: ExecutionOutputSegment[] = []
  for (const [key, label] of [['stdout', 'stdout'], ['stderr', 'stderr'], ['output', 'output'], ['diagnostic', 'diagnóstico'], ['baseline_diagnostic', 'baseline'], ['post_diagnostic', 'pós-verificação'], ['error', 'erro']] as const) {
    const text = typeof event.data[key] === 'string' ? String(event.data[key]).trim() : ''
    if (!text) continue
    if (key === 'stdout' || key === 'stderr') segments.push({ stream: key, text })
    else if (key === 'output') segments.push({ stream: 'meta', text })
    else segments.push({ stream: 'meta', text: `[${label}] ${text}` })
  }
  const reasons = Array.isArray(event.data.reasons) ? (event.data.reasons as unknown[]).map(String).filter(Boolean) : []
  segments.push(...reasons.map((value) => ({ stream: 'meta' as const, text: `[policy] ${value}` })))
  return segments
}

export function setFallbackOutput(entry: ExecutionTimelineEntry, event: HarnessEvent) {
  entry.outputSegments = fallbackOutput(event)
  entry.output = segmentsText(entry.outputSegments)
}

export function segmentsText(segments: ExecutionOutputSegment[]) { return segments.map((segment) => segment.text).join('\n') }

function structuredEventData(event: HarnessEvent) {
  if (!event.data || !Object.keys(event.data).length) return ''
  try { return JSON.stringify(event.data, null, 2) || '' } catch { return String(event.data) }
}

export function statusEventOutput(event: HarnessEvent): ExecutionOutputSegment[] {
  const segments = fallbackOutput(event)
  const structured = event.type === 'execution.recorded' ? '' : structuredEventData(event)
  if (structured) segments.push({ stream: 'meta', text: `[dados]\n${structured}` })
  return segments
}

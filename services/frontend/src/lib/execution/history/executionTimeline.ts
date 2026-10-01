import { statusMeta } from './executionStatus'
import type { HarnessEvent } from '../../../types'

export type ExecutionOutputSegment = {
  stream: 'stdout' | 'stderr' | 'meta'
  text: string
}

export type ExecutionTimelineEntry = {
  id: string
  kind: 'command' | 'patch' | 'status'
  title: string
  detail: string
  badge: string
  tone: 'ok' | 'warning' | 'fail'
  timestamp: string
  durationMs?: number
  running: boolean
  output: string
  outputSegments: ExecutionOutputSegment[]
  lifecycleState?: 'active' | 'waiting' | 'success' | 'failure'
  rationale: string
	requestId: string
	rootRequestId: string
	iterationKind: 'standard' | 'repair' | 'revert_restore' | 'improvement' | 'evidence' | 'conflict'
}

export type ExecutionTimelineOverview = 'active' | 'waiting' | 'failed' | 'recovered' | 'success' | 'neutral'

export type ExecutionSubtaskGroup = {
  id: string
  requestId: string
  rootRequestId: string
  iterationKind: ExecutionTimelineEntry['iterationKind']
  entries: ExecutionTimelineEntry[]
  overview: ExecutionTimelineOverview
  updatedAt: string
}

export function groupExecutionSubtasks(entries: ExecutionTimelineEntry[]): ExecutionSubtaskGroup[] {
  const groups: Omit<ExecutionSubtaskGroup, 'overview'>[] = []
  for (const entry of entries) {
    const requestId = entry.requestId || entry.rootRequestId
    const previous = groups.at(-1)
    if (previous && previous.requestId === requestId && previous.iterationKind === entry.iterationKind) {
      previous.entries.push(entry)
      previous.updatedAt = entry.timestamp
      continue
    }
    groups.push({
      id: `${requestId || 'session'}:${entry.iterationKind}:${groups.length}`,
      requestId,
      rootRequestId: entry.rootRequestId,
      iterationKind: entry.iterationKind,
      entries: [entry],
      updatedAt: entry.timestamp,
    })
  }
  return groups.map((group) => ({ ...group, overview: executionTimelineOverview(group.entries) }))
}

export function executionTimelineOverview(entries: ExecutionTimelineEntry[]): ExecutionTimelineOverview {
  let latestLive: { index: number; state: 'active' | 'waiting' } | undefined
  let latestTerminal: { index: number; state: 'success' | 'failure' } | undefined
  let hadFailure = false

  entries.forEach((entry, index) => {
    if (entry.running || entry.lifecycleState === 'active') latestLive = { index, state: 'active' }
    else if (entry.lifecycleState === 'waiting') latestLive = { index, state: 'waiting' }
    if (entry.lifecycleState === 'failure') {
      hadFailure = true
      latestTerminal = { index, state: 'failure' }
    } else if (entry.lifecycleState === 'success') {
      latestTerminal = { index, state: 'success' }
    }
  })

  if (latestLive && latestLive.index > (latestTerminal?.index ?? -1)) return latestLive.state
  if (latestTerminal?.state === 'failure') return 'failed'
  if (latestTerminal?.state === 'success') return hadFailure ? 'recovered' : 'success'
  if (latestLive) return latestLive.state
  return 'neutral'
}

export function buildExecutionTimeline(events: HarnessEvent[]): ExecutionTimelineEntry[] {
  const entries: ExecutionTimelineEntry[] = []
  const grouped = new Map<string, ExecutionTimelineEntry>()
	let active = { requestId: '', rootRequestId: '', iterationKind: 'standard' as ExecutionTimelineEntry['iterationKind'] }
  for (const event of events) {
		active = eventLineage(event, active)
    if (event.type === 'command.started' || event.type === 'command.output' || event.type === 'command.completed') {
      const runID = String(event.data.run_id || event.id)
      let entry = grouped.get(runID)
      if (!entry) {
        entry = { id: runID, kind: 'command', title: commandTitle(event), detail: commandDetail(event), badge: 'RUN', tone: 'warning', timestamp: event.timestamp, running: true, output: '', outputSegments: [], rationale: commandRationale(event), ...active }
        grouped.set(runID, entry); entries.push(entry)
      }
      if (event.type === 'command.started') {
        entry.title = commandTitle(event); entry.detail = commandDetail(event); entry.timestamp = event.timestamp; entry.rationale = commandRationale(event) || entry.rationale
      } else if (event.type === 'command.output') {
        const text = String(event.data.text || '')
        if (text) appendOutput(entry, event.data.stream === 'stderr' ? 'stderr' : 'stdout', text)
      } else {
        entry.title = commandTitle(event) || entry.title
        entry.detail = commandDetail(event) || entry.detail
        entry.rationale = commandRationale(event) || entry.rationale
        entry.badge = `exit ${String(event.data.exit_code ?? '?')}`
        entry.tone = event.data.success === false ? 'fail' : 'ok'
        entry.running = false
        entry.durationMs = finiteNumber(event.data.duration_ms)
        if (!entry.output) setFallbackOutput(entry, event)
      }
      continue
    }
    if (event.type === 'self_evolution.host_build_started' || event.type === 'self_evolution.host_build_output' || event.type === 'self_evolution.host_build_completed' || event.type === 'self_evolution.host_build_failed') {
      // A self-evolution host build can run for minutes (dependency
      // hydration, npm ci, vite/tsc, go build) with nothing surfaced until
      // it finally succeeds or fails, which reads as a hang. Group it under
      // its transaction_id exactly like a command run, so its live output
      // streams into the same expandable log instead of only appearing
      // after the fact.
      const runID = String(event.data.transaction_id || event.id)
      let entry = grouped.get(runID)
      if (!entry) {
        entry = { id: runID, kind: 'command', title: 'Build do Wharnex no host', detail: '', badge: 'BUILD', tone: 'warning', timestamp: event.timestamp, running: true, output: '', outputSegments: [], rationale: 'Construir o runtime atualizado no host antes de ativar a autoevolução.', ...active }
        grouped.set(runID, entry); entries.push(entry)
      }
      if (event.type === 'self_evolution.host_build_output') {
        const text = String(event.data.text || '')
        if (text) appendOutput(entry, event.data.stream === 'stderr' ? 'stderr' : 'stdout', text)
      } else if (event.type === 'self_evolution.host_build_completed') {
        entry.title = 'Build do Wharnex concluído'; entry.badge = 'OK'; entry.tone = 'ok'; entry.running = false
      } else if (event.type === 'self_evolution.host_build_failed') {
        entry.title = 'Build do Wharnex falhou'; entry.badge = 'FAIL'; entry.tone = 'fail'; entry.running = false; entry.lifecycleState = 'failure'
        if (!entry.output) setFallbackOutput(entry, event)
      }
      continue
    }
    if (event.type === 'patch.started' || event.type === 'patch.applied') {
      const runID = String(event.data.run_id || event.id)
      let entry = grouped.get(runID)
      if (!entry) {
        entry = { id: runID, kind: 'patch', title: patchTitle(event), detail: patchDetail(event), badge: 'RUN', tone: 'warning', timestamp: event.timestamp, running: true, output: '', outputSegments: [], rationale: 'Aplicar a alteração declarada pelo plano no workspace protegido.', ...active }
        grouped.set(runID, entry); entries.push(entry)
      }
      if (event.type === 'patch.applied') {
        entry.title = patchTitle(event); entry.detail = patchDetail(event); entry.badge = 'OK'; entry.tone = 'ok'; entry.running = false; entry.durationMs = finiteNumber(event.data.duration_ms)
      }
      continue
    }
    const meta = statusMeta(event)
    const outputSegments = statusEventOutput(event)
    entries.push({ id: event.id, kind: 'status', timestamp: event.timestamp, running: false, output: segmentsText(outputSegments), outputSegments, rationale: commandRationale(event), ...active, ...meta })
  }
  return entries
}

function eventLineage(event: HarnessEvent, fallback: Pick<ExecutionTimelineEntry, 'requestId' | 'rootRequestId' | 'iterationKind'>) {
	const requestId = String(event.data.request_id || fallback.requestId)
	const rootRequestId = String(event.data.root_request_id || fallback.rootRequestId || requestId)
	const explicit = String(event.data.iteration_kind || '')
	const inferred = event.type.startsWith('workflow.') ? 'evidence' : event.type.startsWith('improvement.') ? 'improvement' : event.type.startsWith('repair.') ? 'repair' : event.type.startsWith('conflict.') ? 'conflict' : fallback.iterationKind
	const iterationKind = (['standard', 'repair', 'revert_restore', 'improvement', 'evidence', 'conflict'].includes(explicit) ? explicit : inferred) as ExecutionTimelineEntry['iterationKind']
	return { requestId, rootRequestId, iterationKind }
}

function commandTitle(event: HarnessEvent) {
  return Array.isArray(event.data.argv) ? (event.data.argv as unknown[]).map(String).join(' ') : 'Comando'
}
function commandDetail(event: HarnessEvent) { return [String(event.data.cwd || '.'), String(event.data.target || '')].filter(Boolean).join(' · ') }
function commandRationale(event: HarnessEvent) { return String(event.data.rationale || '').trim() }
function patchTitle(event: HarnessEvent) { return event.type === 'patch.applied' ? 'Patch aplicado' : 'Aplicando patch' }
function patchDetail(event: HarnessEvent) {
  const files = Array.isArray(event.data.files) ? (event.data.files as unknown[]).map(String).filter(Boolean) : []
  return [String(event.data.target || ''), files.join(', ')].filter(Boolean).join(' · ')
}
function finiteNumber(value: unknown) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : undefined }

function appendOutput(entry: ExecutionTimelineEntry, stream: 'stdout' | 'stderr', text: string) {
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

function setFallbackOutput(entry: ExecutionTimelineEntry, event: HarnessEvent) {
  entry.outputSegments = fallbackOutput(event)
  entry.output = segmentsText(entry.outputSegments)
}

function segmentsText(segments: ExecutionOutputSegment[]) { return segments.map((segment) => segment.text).join('\n') }

function structuredEventData(event: HarnessEvent) {
  if (!event.data || !Object.keys(event.data).length) return ''
  try { return JSON.stringify(event.data, null, 2) || '' } catch { return String(event.data) }
}

function statusEventOutput(event: HarnessEvent): ExecutionOutputSegment[] {
  const segments = fallbackOutput(event)
  const structured = structuredEventData(event)
  if (structured) segments.push({ stream: 'meta', text: `[dados]\n${structured}` })
  return segments
}

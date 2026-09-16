import type { HarnessEvent } from '../types'

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
	requestId: string
	rootRequestId: string
	iterationKind: 'standard' | 'repair' | 'revert_restore' | 'improvement' | 'evidence' | 'conflict'
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
        entry = { id: runID, kind: 'command', title: commandTitle(event), detail: commandDetail(event), badge: 'RUN', tone: 'warning', timestamp: event.timestamp, running: true, output: '', outputSegments: [], ...active }
        grouped.set(runID, entry); entries.push(entry)
      }
      if (event.type === 'command.started') {
        entry.title = commandTitle(event); entry.detail = commandDetail(event); entry.timestamp = event.timestamp
      } else if (event.type === 'command.output') {
        const text = String(event.data.text || '')
        if (text) appendOutput(entry, event.data.stream === 'stderr' ? 'stderr' : 'stdout', text)
      } else {
        entry.title = commandTitle(event) || entry.title
        entry.detail = commandDetail(event) || entry.detail
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
        entry = { id: runID, kind: 'command', title: 'Build do Wharnex no host', detail: '', badge: 'BUILD', tone: 'warning', timestamp: event.timestamp, running: true, output: '', outputSegments: [], ...active }
        grouped.set(runID, entry); entries.push(entry)
      }
      if (event.type === 'self_evolution.host_build_output') {
        const text = String(event.data.text || '')
        if (text) appendOutput(entry, event.data.stream === 'stderr' ? 'stderr' : 'stdout', text)
      } else if (event.type === 'self_evolution.host_build_completed') {
        entry.title = 'Build do Wharnex concluído'; entry.badge = 'OK'; entry.tone = 'ok'; entry.running = false
      } else if (event.type === 'self_evolution.host_build_failed') {
        entry.title = 'Build do Wharnex falhou'; entry.badge = 'FAIL'; entry.tone = 'fail'; entry.running = false
        if (!entry.output) setFallbackOutput(entry, event)
      }
      continue
    }
    if (event.type === 'patch.started' || event.type === 'patch.applied') {
      const runID = String(event.data.run_id || event.id)
      let entry = grouped.get(runID)
      if (!entry) {
        entry = { id: runID, kind: 'patch', title: patchTitle(event), detail: patchDetail(event), badge: 'RUN', tone: 'warning', timestamp: event.timestamp, running: true, output: '', outputSegments: [], ...active }
        grouped.set(runID, entry); entries.push(entry)
      }
      if (event.type === 'patch.applied') {
        entry.title = patchTitle(event); entry.detail = patchDetail(event); entry.badge = 'OK'; entry.tone = 'ok'; entry.running = false; entry.durationMs = finiteNumber(event.data.duration_ms)
      }
      continue
    }
    const meta = statusMeta(event)
    const outputSegments = statusEventOutput(event)
    entries.push({ id: event.id, kind: 'status', timestamp: event.timestamp, running: false, output: segmentsText(outputSegments), outputSegments, ...active, ...meta })
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
  for (const [key, label] of [['stdout', 'stdout'], ['stderr', 'stderr'], ['diagnostic', 'diagnóstico'], ['baseline_diagnostic', 'baseline'], ['post_diagnostic', 'pós-verificação'], ['error', 'erro']] as const) {
    const text = typeof event.data[key] === 'string' ? String(event.data[key]).trim() : ''
    if (!text) continue
    if (key === 'stdout' || key === 'stderr') segments.push({ stream: key, text })
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

function statusMeta(event: HarnessEvent) {
  const target = String(event.data.target || '')
  const exit = event.data.exit_code !== undefined ? `exit ${String(event.data.exit_code)}` : ''
  switch (event.type) {
    case 'execution.started': return { title: 'Execução iniciada', detail: target || String(event.data.execution_mode || ''), badge: 'RUN', tone: 'warning' as const }
    case 'execution.completed': return { title: 'Execução concluída', detail: target, badge: 'OK', tone: 'ok' as const }
    case 'execution.failed': case 'automation.execution_failed': return { title: 'Execução falhou', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const }
    case 'execution.duplicate_blocked': return { title: 'Reexecução bloqueada', detail: `Plano ${String(event.data.plan_id || '')} já concluído`, badge: 'DONE', tone: 'warning' as const }
    case 'host.apply_started': return { title: 'Aplicação no host iniciada', detail: `${String(event.data.patch_count || 0)} patch(es)`, badge: 'HOST', tone: 'warning' as const }
    case 'host.apply_failed': return { title: 'Aplicação no host falhou', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const }
    case 'host.applied': return { title: 'Alterações aplicadas no host', detail: '', badge: 'HOST', tone: 'ok' as const }
    case 'host.pending_rejected': return { title: 'Alterações pendentes rejeitadas', detail: `${String(event.data.plan_count || 0)} plano(s) descartado(s)`, badge: 'REJECT', tone: 'warning' as const }
    case 'host.revert_started': return { title: 'Reversão no host iniciada', detail: `${String(event.data.patch_count || 0)} patch(es)`, badge: 'REVERT', tone: 'warning' as const }
    case 'host.reverted': return { title: 'Alterações revertidas no host', detail: '', badge: 'REVERT', tone: 'ok' as const }
    case 'host.restore_started': return { title: 'Reposição no host iniciada', detail: `${String(event.data.patch_count || 0)} patch(es)`, badge: 'RESTORE', tone: 'warning' as const }
    case 'host.restore_failed': return { title: 'Reposição direta falhou', detail: String(event.data.error || ''), badge: 'RESTORE', tone: 'fail' as const }
    case 'host.restore_recovery_started': return { title: 'Conciliação da reposição iniciada', detail: String(event.data.error || ''), badge: 'GPT', tone: 'warning' as const }
    case 'host.restored': return { title: 'Alteração reposta no host', detail: '', badge: 'RESTORE', tone: 'ok' as const }
    case 'host_dependency_repair.started': return { title: 'Reinstalação de dependências do host iniciada', detail: String(event.data.cwd || ''), badge: 'REPAIR', tone: 'warning' as const }
    case 'host_dependency_repair.command_started': return { title: 'Comando de reparo iniciado', detail: (event.data.argv as string[] | undefined)?.join(' ') || '', badge: 'REPAIR', tone: 'warning' as const }
    case 'host_dependency_repair.command_completed': return { title: 'Comando de reparo concluído', detail: (event.data.argv as string[] | undefined)?.join(' ') || '', badge: exit, tone: event.data.success ? 'ok' as const : 'fail' as const }
    case 'host_dependency_repair.completed': return { title: 'Dependências do host reinstaladas', detail: String(event.data.cwd || ''), badge: 'REPAIR', tone: 'ok' as const }
    case 'host_dependency_repair.failed': return { title: 'Reinstalação de dependências do host falhou', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const }
    case 'host_dependency_repair.reverify_failed': return { title: 'Dependências reinstaladas, mas a verificação ainda falha', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const }
    case 'verification.started': return { title: 'Verificação iniciada', detail: target, badge: 'CHECK', tone: 'warning' as const }
    case 'verification.completed': return { title: 'Verificação concluída', detail: target, badge: exit, tone: event.data.baseline_failure ? 'warning' as const : 'ok' as const }
    case 'verification.baseline_unchanged': return { title: 'Falha pré-existente inalterada', detail: 'baseline unchanged', badge: exit, tone: 'warning' as const }
    case 'verification.baseline_changed': return { title: 'Baseline alterada', detail: 'verification drift', badge: 'WARN', tone: 'warning' as const }
    case 'automation.approval_required': return { title: 'Aprovação necessária', detail: String(event.data.risk || ''), badge: 'APPROVE', tone: 'warning' as const }
    case 'automation.policy_blocked': case 'workflow.policy_blocked': return { title: 'Policy bloqueou a execução', detail: '', badge: 'BLOCK', tone: 'fail' as const }
    case 'repair.started': return { title: event.data.iteration_kind === 'revert_restore' ? 'Conciliação da reposição iniciada' : 'Correção automática iniciada', detail: '', badge: `#${String(event.data.attempt || '')}`, tone: 'warning' as const }
    case 'repair.prompt_ready': return { title: event.data.iteration_kind === 'revert_restore' ? 'Pedido de reposição pronto' : 'Prompt de correção pronto', detail: '', badge: 'READY', tone: 'warning' as const }
    case 'repair.prepare_failed': return { title: 'Falha ao preparar correção', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const }
    case 'workflow.started': return { title: 'Investigação local iniciada', detail: '', badge: event.data.round ? `${String(event.data.round)}/6` : 'RUN', tone: 'warning' as const }
    case 'workflow.completed': return { title: 'Passo local concluído', detail: '', badge: 'OK', tone: 'ok' as const }
    case 'workflow.step_failed': return { title: 'Passo local produziu diagnóstico', detail: '', badge: 'WARN', tone: 'warning' as const }
    case 'workflow.continuation_started': return { title: 'Continuação com evidências iniciada', detail: '', badge: event.data.round ? `${String(event.data.round)}/6` : 'RUN', tone: 'warning' as const }
    case 'workflow.prompt_ready': return { title: 'Continuação pronta para o ChatGPT', detail: '', badge: 'READY', tone: 'ok' as const }
    default: return { title: event.type, detail: compactEventData(event), badge: 'EVENT', tone: genericEventTone(event) }
  }
}

function compactEventData(event: HarnessEvent) {
  const keys = ['plan_id', 'request_id', 'state', 'status', 'transport', 'target', 'reason', 'attempt', 'round', 'position']
  const parts = keys.flatMap((key) => {
    const value = event.data[key]
    if (value === undefined || value === null || value === '') return []
    return [`${key}=${Array.isArray(value) ? value.map(String).join(',') : String(value)}`]
  })
  return parts.slice(0, 4).join(' · ')
}

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

function genericEventTone(event: HarnessEvent): ExecutionTimelineEntry['tone'] {
  if (/failed|error|blocked|rejected|exhausted|rollback_failed/i.test(event.type) || event.data.success === false) return 'fail'
  if (/warning|degraded|skipped|retry|required|stalled|pending/i.test(event.type)) return 'warning'
  return 'ok'
}

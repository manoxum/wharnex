import type { HarnessEvent } from '../types'

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
}

export function buildExecutionTimeline(events: HarnessEvent[]): ExecutionTimelineEntry[] {
  const entries: ExecutionTimelineEntry[] = []
  const grouped = new Map<string, ExecutionTimelineEntry>()
  for (const event of events) {
    if (event.type === 'command.started' || event.type === 'command.output' || event.type === 'command.completed') {
      const runID = String(event.data.run_id || event.id)
      let entry = grouped.get(runID)
      if (!entry) {
        entry = { id: runID, kind: 'command', title: commandTitle(event), detail: commandDetail(event), badge: 'RUN', tone: 'warning', timestamp: event.timestamp, running: true, output: '' }
        grouped.set(runID, entry); entries.push(entry)
      }
      if (event.type === 'command.started') {
        entry.title = commandTitle(event); entry.detail = commandDetail(event); entry.timestamp = event.timestamp
      } else if (event.type === 'command.output') {
        const text = String(event.data.text || '')
        if (text) entry.output += `${event.data.stream === 'stderr' ? '[stderr]' : '[stdout]'} ${text}`
      } else {
        entry.title = commandTitle(event) || entry.title
        entry.detail = commandDetail(event) || entry.detail
        entry.badge = `exit ${String(event.data.exit_code ?? '?')}`
        entry.tone = event.data.success === false ? 'fail' : 'ok'
        entry.running = false
        entry.durationMs = finiteNumber(event.data.duration_ms)
        if (!entry.output) entry.output = joinedFallback(event)
      }
      continue
    }
    if (event.type === 'patch.started' || event.type === 'patch.applied') {
      const runID = String(event.data.run_id || event.id)
      let entry = grouped.get(runID)
      if (!entry) {
        entry = { id: runID, kind: 'patch', title: patchTitle(event), detail: patchDetail(event), badge: 'RUN', tone: 'warning', timestamp: event.timestamp, running: true, output: '' }
        grouped.set(runID, entry); entries.push(entry)
      }
      if (event.type === 'patch.applied') {
        entry.title = patchTitle(event); entry.detail = patchDetail(event); entry.badge = 'OK'; entry.tone = 'ok'; entry.running = false; entry.durationMs = finiteNumber(event.data.duration_ms)
      }
      continue
    }
    const meta = statusMeta(event)
    entries.push({ id: event.id, kind: 'status', timestamp: event.timestamp, running: false, output: joinedFallback(event), ...meta })
  }
  return entries
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

function joinedFallback(event: HarnessEvent) {
  const chunks: string[] = []
  for (const [key, label] of [['stdout', 'stdout'], ['stderr', 'stderr'], ['diagnostic', 'diagnóstico'], ['baseline_diagnostic', 'baseline'], ['post_diagnostic', 'pós-verificação'], ['error', 'erro']] as const) {
    const text = typeof event.data[key] === 'string' ? String(event.data[key]).trim() : ''
    if (text) chunks.push(`[${label}] ${text}`)
  }
  const reasons = Array.isArray(event.data.reasons) ? (event.data.reasons as unknown[]).map(String).filter(Boolean) : []
  chunks.push(...reasons.map((value) => `[policy] ${value}`))
  return chunks.join('\n')
}

function statusMeta(event: HarnessEvent) {
  const target = String(event.data.target || '')
  const exit = event.data.exit_code !== undefined ? `exit ${String(event.data.exit_code)}` : ''
  switch (event.type) {
    case 'execution.started': return { title: 'Execução iniciada', detail: target || String(event.data.execution_mode || ''), badge: 'RUN', tone: 'warning' as const }
    case 'execution.completed': return { title: 'Execução concluída', detail: target, badge: 'OK', tone: 'ok' as const }
    case 'execution.failed': case 'automation.execution_failed': return { title: 'Execução falhou', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const }
    case 'host.apply_started': return { title: 'Aplicação no host iniciada', detail: `${String(event.data.patch_count || 0)} patch(es)`, badge: 'HOST', tone: 'warning' as const }
    case 'host.applied': return { title: 'Alterações aplicadas no host', detail: '', badge: 'HOST', tone: 'ok' as const }
    case 'host.revert_started': return { title: 'Reversão no host iniciada', detail: `${String(event.data.patch_count || 0)} patch(es)`, badge: 'REVERT', tone: 'warning' as const }
    case 'host.reverted': return { title: 'Alterações revertidas no host', detail: '', badge: 'REVERT', tone: 'ok' as const }
    case 'self_evolution.host_build_started': return { title: 'Build do Wharness no host', detail: '', badge: 'BUILD', tone: 'warning' as const }
    case 'self_evolution.host_build_completed': return { title: 'Build do Wharness concluído', detail: '', badge: 'OK', tone: 'ok' as const }
    case 'verification.started': return { title: 'Verificação iniciada', detail: target, badge: 'CHECK', tone: 'warning' as const }
    case 'verification.completed': return { title: 'Verificação concluída', detail: target, badge: exit, tone: event.data.baseline_failure ? 'warning' as const : 'ok' as const }
    case 'verification.baseline_unchanged': return { title: 'Falha pré-existente inalterada', detail: 'baseline unchanged', badge: exit, tone: 'warning' as const }
    case 'verification.baseline_changed': return { title: 'Baseline alterada', detail: 'verification drift', badge: 'WARN', tone: 'warning' as const }
    case 'automation.approval_required': return { title: 'Aprovação necessária', detail: String(event.data.risk || ''), badge: 'APPROVE', tone: 'warning' as const }
    case 'automation.policy_blocked': case 'workflow.policy_blocked': return { title: 'Policy bloqueou a execução', detail: '', badge: 'BLOCK', tone: 'fail' as const }
    case 'repair.started': return { title: 'Correção automática iniciada', detail: '', badge: `#${String(event.data.attempt || '')}`, tone: 'warning' as const }
    case 'repair.prompt_ready': return { title: 'Prompt de correção pronto', detail: '', badge: 'READY', tone: 'warning' as const }
    case 'repair.prepare_failed': return { title: 'Falha ao preparar correção', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const }
    case 'workflow.started': return { title: 'Investigação local iniciada', detail: '', badge: event.data.round ? `${String(event.data.round)}/6` : 'RUN', tone: 'warning' as const }
    case 'workflow.completed': return { title: 'Passo local concluído', detail: '', badge: 'OK', tone: 'ok' as const }
    case 'workflow.step_failed': return { title: 'Passo local produziu diagnóstico', detail: '', badge: 'WARN', tone: 'warning' as const }
    case 'workflow.continuation_started': return { title: 'Continuação com evidências iniciada', detail: '', badge: event.data.round ? `${String(event.data.round)}/6` : 'RUN', tone: 'warning' as const }
    case 'workflow.prompt_ready': return { title: 'Continuação pronta para o ChatGPT', detail: '', badge: 'READY', tone: 'ok' as const }
    default: return { title: event.type, detail: '', badge: '', tone: 'ok' as const }
  }
}

import type { HarnessEvent } from '../../../types'

export function statusMeta(event: HarnessEvent) {
  const target = String(event.data.target || '')
  const exit = event.data.exit_code !== undefined ? `exit ${String(event.data.exit_code)}` : ''
  switch (event.type) {
    case 'execution.queued': return { title: 'Execução em fila', detail: event.data.position ? `posição ${String(event.data.position)}` : '', badge: 'QUEUE', tone: 'warning' as const, lifecycleState: 'waiting' as const }
    case 'execution.dequeued': return { title: 'Execução pronta para iniciar', detail: target, badge: 'READY', tone: 'warning' as const, lifecycleState: 'waiting' as const }
    case 'execution.started': return { title: 'Execução iniciada', detail: target || String(event.data.execution_mode || ''), badge: 'RUN', tone: 'warning' as const, lifecycleState: 'active' as const }
    case 'execution.completed': return { title: 'Execução concluída', detail: target, badge: 'OK', tone: 'ok' as const, lifecycleState: 'success' as const }
    case 'execution.failed': case 'automation.execution_failed': return { title: 'Execução falhou', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const, lifecycleState: 'failure' as const }
    case 'execution.duplicate_blocked': return { title: 'Reexecução bloqueada', detail: `Plano ${String(event.data.plan_id || '')} já concluído`, badge: 'DONE', tone: 'warning' as const }
    case 'host.apply_started': return { title: 'Aplicação no host iniciada', detail: `${String(event.data.patch_count || 0)} patch(es)`, badge: 'HOST', tone: 'warning' as const, lifecycleState: 'active' as const }
    case 'host.apply_failed': return { title: 'Aplicação no host falhou', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const, lifecycleState: 'failure' as const }
    case 'host.apply_settled':
    case 'host.applied': return { title: 'Alterações aplicadas no host', detail: '', badge: 'HOST', tone: 'ok' as const, lifecycleState: 'success' as const }
    case 'host.pending_rejected': return { title: 'Alterações pendentes rejeitadas', detail: `${String(event.data.plan_count || 0)} plano(s) descartado(s)`, badge: 'REJECT', tone: 'warning' as const }
    case 'host.revert_started': return { title: 'Reversão no host iniciada', detail: `${String(event.data.patch_count || 0)} patch(es)`, badge: 'REVERT', tone: 'warning' as const, lifecycleState: 'active' as const }
    case 'host.reverted': return { title: 'Alterações revertidas no host', detail: '', badge: 'REVERT', tone: 'ok' as const, lifecycleState: 'success' as const }
    case 'host.restore_started': return { title: 'Reposição no host iniciada', detail: `${String(event.data.patch_count || 0)} patch(es)`, badge: 'RESTORE', tone: 'warning' as const, lifecycleState: 'active' as const }
    case 'host.restore_failed': return { title: 'Reposição direta falhou', detail: String(event.data.error || ''), badge: 'RESTORE', tone: 'fail' as const, lifecycleState: 'failure' as const }
    case 'host.restore_recovery_started': return { title: 'Conciliação da reposição iniciada', detail: String(event.data.error || ''), badge: 'GPT', tone: 'warning' as const, lifecycleState: 'active' as const }
    case 'host.restored': return { title: 'Alteração reposta no host', detail: '', badge: 'RESTORE', tone: 'ok' as const, lifecycleState: 'success' as const }
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
    case 'automation.approval_required': { const approvals = event.data.approval_items as Array<{ kind?: string; argv?: string[]; requires_sudo_password?: boolean }> | undefined; const approval = approvals?.find((item) => item.requires_sudo_password) || approvals?.find((item) => item.argv?.length) || approvals?.[0]; const detail = approval?.argv?.length ? `${approval.requires_sudo_password ? 'sudo + senha' : approval.kind || 'comando'} · ${JSON.stringify(approval.argv)}` : String(event.data.risk || ''); return { title: 'Aprovação necessária', detail, badge: 'APPROVE', tone: 'warning' as const, lifecycleState: 'waiting' as const } }
    case 'automation.approval_auto_granted': return { title: 'Aprovação automática', detail: String(event.data.risk || ''), badge: 'AUTO', tone: 'ok' as const }
    case 'automation.policy_blocked': case 'workflow.policy_blocked': return { title: 'Policy bloqueou a execução', detail: '', badge: 'BLOCK', tone: 'fail' as const, lifecycleState: 'failure' as const }
    case 'repair.started': return { title: event.data.iteration_kind === 'revert_restore' ? 'Conciliação da reposição iniciada' : 'Correção automática iniciada', detail: '', badge: `#${String(event.data.attempt || '')}`, tone: 'warning' as const, lifecycleState: 'active' as const }
    case 'repair.prompt_ready': return { title: event.data.iteration_kind === 'revert_restore' ? 'Pedido de reposição pronto' : 'Prompt de correção pronto', detail: '', badge: 'READY', tone: 'warning' as const, lifecycleState: 'waiting' as const }
    case 'repair.prepare_failed': return { title: 'Falha ao preparar correção', detail: String(event.data.error || ''), badge: 'FAIL', tone: 'fail' as const, lifecycleState: 'failure' as const }
    case 'workflow.started': return { title: 'Investigação local iniciada', detail: '', badge: event.data.round ? `${String(event.data.round)}/6` : 'RUN', tone: 'warning' as const }
    case 'workflow.completed': return { title: 'Passo local concluído', detail: '', badge: 'OK', tone: 'ok' as const }
    case 'workflow.step_failed': return { title: 'Passo local produziu diagnóstico', detail: '', badge: 'WARN', tone: 'warning' as const }
    case 'workflow.continuation_started': return { title: 'Continuação com evidências iniciada', detail: '', badge: event.data.round ? `${String(event.data.round)}/6` : 'RUN', tone: 'warning' as const }
    case 'workflow.prompt_ready': return { title: 'Continuação pronta para o ChatGPT', detail: '', badge: 'READY', tone: 'warning' as const, lifecycleState: 'waiting' as const }
    case 'conflict.prompt_ready': return { title: 'Resolução de conflito pronta', detail: '', badge: 'READY', tone: 'warning' as const, lifecycleState: 'waiting' as const }
    case 'baseline.continuation_ready': return { title: 'Continuação pronta', detail: '', badge: 'READY', tone: 'warning' as const, lifecycleState: 'waiting' as const }
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

function genericEventTone(event: HarnessEvent): 'ok' | 'warning' | 'fail' {
  if (/failed|error|blocked|rejected|exhausted|rollback_failed/i.test(event.type) || event.data.success === false) return 'fail'
  if (/warning|degraded|skipped|retry|required|stalled|pending/i.test(event.type)) return 'warning'
  return 'ok'
}

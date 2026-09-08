import type { Session } from '../types'
import type { WorkspaceChat } from './workspaceMemory'

export type AttentionTone = 'danger' | 'warning' | 'success'
export type AttentionTarget = 'plan' | 'terminal' | 'chatgpt'
export type AttentionAction = 'approve-execution' | 'retry-dependency-network' | 'repair-host-dependency' | 'retry-host-apply' | 'apply-host'
export type AttentionItem = {
  id: string
  chatId: string
  chatTitle: string
  title: string
  detail: string
  tone: AttentionTone
  target?: AttentionTarget
  action?: AttentionAction
}

export type AttentionHumanAction = {
  cacheKey: string
  active: boolean
  kind: string
  message: string
}

const PENDING_RESOLUTION_STATES = new Set([
  'awaiting_plan', 'workflow_pending', 'workflow_planned', 'workflow_observed',
  'repair_pending', 'planned', 'baseline_update_pending', 'conflict_resolution_pending',
])

const APPLY_RETRY_FAILURES = new Set(['self_evolution_transaction_busy', 'self_evolution_transaction_metadata_mismatch', 'host_integration_race'])
const APPLY_BLOCKING_FAILURES = new Set(['offline_go_module_cache', 'host_build_toolchain_mismatch', 'host_dependency_state', ...APPLY_RETRY_FAILURES])

export function collectAttentionItems(
  chats: WorkspaceChat[],
  sessions: Record<string, Session | undefined>,
  humanActions: Record<string, AttentionHumanAction> = {},
): AttentionItem[] {
  const items = chats.flatMap((chat) => {
    const session = sessions[chat.id]
    const actionKeys = new Set([chat.id, ...Object.values(chat.conflictSurfaces || {}).filter((surface) => !surface.resolvedAt).map((surface) => surface.cacheKey)])
    const humanAction = Object.values(humanActions).find((action) => action.active && actionKeys.has(action.cacheKey))
    return attentionItemsForChat(chat, session, humanAction)
  })
  return items.sort((left, right) => attentionRank(left.tone) - attentionRank(right.tone) || left.chatTitle.localeCompare(right.chatTitle) || left.title.localeCompare(right.title))
}

export function attentionItemsForChat(chat: WorkspaceChat, session?: Session, humanAction?: AttentionHumanAction): AttentionItem[] {
  const items: AttentionItem[] = []
  if (humanAction?.active) {
    items.push(item(chat, 'chatgpt-human-action', 'warning', 'Ação humana necessária no ChatGPT', humanAction.message || 'A automação está pausada até concluir a ação humana.', 'chatgpt'))
  }
  if (!session) return items

  const pendingCount = session.pending_host_changes?.length || 0
  const pendingResolutionBlocked = Boolean(session.planner_in_flight || session.pending_manual_request_ids?.length || PENDING_RESOLUTION_STATES.has(session.state))
  const canApply = session.execution_mode !== 'unprotected' && pendingCount > 0 && !pendingResolutionBlocked && session.last_turn?.kind !== 'workflow'
  const canExecute = Boolean(session.plan && session.policy?.allowed && ['planned', 'failed'].includes(session.state) && session.last_turn?.kind !== 'workflow')
  let failureAlertAdded = false

  if (session.integration_conflict) {
    items.push(item(chat, 'integration-conflict', 'danger', 'Conflito de integração', `${session.integration_conflict.paths.length || 1} ficheiro(s) precisam de resolução antes de continuar.`, 'chatgpt'))
  }
  if (session.interrupted_execution) {
    const status = session.interrupted_execution.status || 'awaiting_decision'
    items.push(item(chat, 'interrupted-execution', 'danger', 'Execução interrompida', `Plano ${session.interrupted_execution.plan_id} · ${status}.`, 'terminal'))
  }

  switch (session.failure_kind) {
    case 'host_build_toolchain_mismatch':
      items.push(item(chat, 'host-toolchain', 'danger', 'Build do host bloqueado', 'A toolchain do host é incompatível com a dependência fixada; requer intervenção local.', 'terminal'))
      failureAlertAdded = true
      break
    case 'host_dependency_state':
      items.push(item(chat, 'host-dependency', 'warning', 'Dependências do host incompletas', 'Reinstale as dependências do host e repita a aplicação verificada.', 'terminal', 'repair-host-dependency'))
      failureAlertAdded = true
      break
    case 'offline_go_module_cache':
      items.push(item(chat, 'dependency-network', 'warning', 'Dependências precisam de rede', 'A execução está parada até autorizar a tentativa restrita com rede.', 'plan', 'retry-dependency-network'))
      failureAlertAdded = true
      break
    case 'self_evolution_transaction_metadata_mismatch':
      if (pendingCount) {
        items.push(item(chat, 'host-apply-retry', 'warning', 'Aplicação ao host pronta para repetir', 'A candidata continua verificada; o estado transacional local será validado e reparado com segurança antes do novo Apply.', 'plan', 'retry-host-apply'))
        failureAlertAdded = true
      }
      break
    case 'self_evolution_transaction_busy':
    case 'host_integration_race':
      if (pendingCount) {
        items.push(item(chat, 'host-apply-retry', 'warning', 'Aplicação ao host pronta para repetir', 'A candidata continua verificada; uma disputa local temporária impediu o Apply anterior.', 'plan', 'retry-host-apply'))
        failureAlertAdded = true
      }
      break
  }

  if (canExecute && session.policy?.requires_approval) {
    items.push(item(chat, 'approval-required', 'warning', 'Aprovação necessária', `Plano pronto para executar · risco ${session.policy.risk}.`, 'plan', 'approve-execution'))
  } else if (session.plan && session.policy && !session.policy.allowed) {
    items.push(item(chat, 'policy-blocked', 'danger', 'Plano bloqueado pela Policy', session.policy.reasons?.[0] || 'Revise o plano antes de executar.', 'plan'))
  }

  if (canApply && !APPLY_BLOCKING_FAILURES.has(session.failure_kind || '')) {
    items.push(item(chat, 'host-apply', 'success', 'Alterações prontas para o host', pendingCount === 1 ? '1 candidata verificada aguarda aplicação no host.' : `${pendingCount} candidatas verificadas aguardam aplicação no host.`, 'plan', 'apply-host'))
  }

  if (session.self_evolution_activation === 'restart_pending') {
    items.push(item(chat, 'restart-pending', 'warning', 'Reinício do Wharness pendente', 'As alterações já foram aplicadas e construídas; falta confirmar o reinício.', 'plan'))
  }
  if (session.last_turn?.kind === 'clarification') {
    items.push(item(chat, 'clarification', 'warning', 'Resposta necessária', session.last_turn.message || 'O pedido aguarda um esclarecimento para continuar.'))
  } else if (session.last_turn?.kind === 'blocked' && !(session.plan && session.policy && !session.policy.allowed) && !failureAlertAdded) {
    items.push(item(chat, 'turn-blocked', 'danger', 'Pedido bloqueado', session.last_turn.message || 'O pedido não pode continuar sem intervenção.'))
  }

  return items
}

function item(chat: WorkspaceChat, suffix: string, tone: AttentionTone, title: string, detail: string, target?: AttentionTarget, action?: AttentionAction): AttentionItem {
  return { id: `${chat.id}:${suffix}`, chatId: chat.id, chatTitle: chat.title, title, detail, tone, target, action }
}

function attentionRank(tone: AttentionTone) {
  if (tone === 'danger') return 0
  if (tone === 'warning') return 1
  return 2
}

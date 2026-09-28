import type { Session } from '../types'
import type { WorkspaceChat } from './workspaceMemory'
import { executionNeedsAttention, sessionCanExecutePlan, sessionNeedsExecutionConsent } from './executionRecovery'
import { PLANNER_GUIDANCE_REQUIRED, plannerDeclaredNonRetryable } from './plannerRecovery'
import { hostApplyAttention } from './hostApplyAttention'
import { compareAttentionItems, mergeAttentionItems } from './attentionItems'

export type AttentionTone = 'danger' | 'warning' | 'success'
export type AttentionKind = 'task-completed' | 'restart-pending'
export type AttentionTarget = 'plan' | 'terminal' | 'chatgpt'
export type AttentionAction = 'approve-execution' | 'approve-debug' | 'retry-dependency-network' | 'repair-host-dependency' | 'repair-with-gpt' | 'retry-transport' | 'retry-host-apply'
export const ATTENTION_ACTION_LABEL: Record<AttentionAction, string> = {
  'approve-execution': 'Aprovar e executar',
  'approve-debug': 'Autorizar debug',
  'retry-dependency-network': 'Permitir rede e repetir',
  'repair-host-dependency': 'Reinstalar dependências e repetir',
  'repair-with-gpt': 'Corrigir com GPT',
  'retry-transport': 'Repetir pedido',
  'retry-host-apply': 'Repetir aplicação',
}
export type AttentionItem = {
  id: string
  chatId: string
  chatTitle: string
  title: string
  detail: string
  tone: AttentionTone
  target?: AttentionTarget
  action?: AttentionAction
  requestId?: string
  kind?: AttentionKind
  occurredAt?: string
  orchestratorTaskId?: string
  orchestratorRunId?: string
}

export type AttentionSummary = {
  total: number
  urgent: number
  actionable: number
  chats: number
}

export type AttentionHumanAction = {
  cacheKey: string
  active: boolean
  kind: string
  message: string
}

const PENDING_RESOLUTION_STATES = new Set([
  'awaiting_plan', 'awaiting_plan_approval', 'workflow_pending', 'workflow_planned', 'workflow_observed',
  'repair_pending', 'planned', 'debug_approval_required', 'baseline_update_pending', 'conflict_resolution_pending',
])

export function sessionHostResolutionBlocked(session: Session) {
  return Boolean(session.planner_in_flight || session.pending_manual_request_ids?.length || PENDING_RESOLUTION_STATES.has(session.state) || session.last_turn?.kind === 'workflow')
}

export function collectAttentionItems(
  chats: WorkspaceChat[],
  sessions: Record<string, Session | undefined>,
  humanActions: Record<string, AttentionHumanAction> = {},
): AttentionItem[] {
  const items = chats.flatMap((chat) => {
    const session = sessions[chat.id]
    const humanAction = humanActions[chat.id]?.active ? humanActions[chat.id] : undefined
    return attentionItemsForChat(chat, session, humanAction)
  })
  // localStorage and the durable chat index are reconciled asynchronously. A
  // duplicated chat during that narrow window must not double the visible
  // alert count or render duplicate React keys. The semantic alert id is the
  // stable consolidation boundary: distinct problems in one chat remain
  // distinct, while duplicate projections collapse to one card.
  return mergeAttentionItems(items)
}

export function summarizeAttention(items: AttentionItem[]): AttentionSummary {
  const chats = new Set<string>()
  let urgent = 0
  let actionable = 0
  for (const entry of items) {
    chats.add(entry.chatId)
    if (entry.tone === 'danger') urgent += 1
    if (entry.action) actionable += 1
  }
  return { total: items.length, urgent, actionable, chats: chats.size }
}

// The popup is a triage surface, not a second full alert center. Put concrete
// recovery actions first, then urgent inspection-only alerts, and keep the
// remainder bounded behind the full drawer so fourteen alerts do not turn a
// command-bar popup into an unreadable viewport-length wall.
export function attentionPreviewItems(items: AttentionItem[], limit = 8): AttentionItem[] {
  return [...items]
    .sort((left, right) => Number(Boolean(right.action)) - Number(Boolean(left.action)) || compareAttentionItems(left, right))
    .slice(0, Math.max(0, limit))
}

export function attentionResolutionLabel(item: AttentionItem) {
  if (item.kind === 'restart-pending') return 'Rever e ativar'
  if (item.kind === 'task-completed') return 'Abrir conclusão'
  if (item.action) return ATTENTION_ACTION_LABEL[item.action]
  if (item.target === 'chatgpt') return 'Abrir o Engine e resolver'
  if (item.target === 'terminal') return 'Abrir a execução'
  if (item.target === 'plan') return 'Abrir o plano'
  return 'Abrir o chat e responder'
}

export function attentionItemsForChat(chat: WorkspaceChat, session?: Session, humanAction?: AttentionHumanAction): AttentionItem[] {
  const items: AttentionItem[] = []
  if (humanAction?.active) {
    items.push(item(chat, 'chatgpt-human-action', 'warning', 'Ação humana necessária no ChatGPT', humanAction.message || 'A automação está pausada até concluir a ação humana.', 'chatgpt'))
  }
  if (!session) return items

  const pendingCount = session.pending_host_changes?.length || 0
  const canExecute = sessionCanExecutePlan(session)
  let failureAlertAdded = false

  if (session.integration_conflict) {
    items.push(item(chat, 'integration-conflict', 'danger', 'Conflito de integração', `${session.integration_conflict.paths.length || 1} ficheiro(s) precisam de resolução antes de continuar.`, 'chatgpt'))
  }
  if (executionNeedsAttention(session)) {
    const status = session.interrupted_execution.status || 'awaiting_decision'
    items.push(item(chat, 'interrupted-execution', 'danger', 'Execução interrompida', `Plano ${session.interrupted_execution.plan_id} · ${status}.`, 'terminal'))
  }
  if (session.state === 'debug_approval_required' && session.plan?.debug) {
    const target = session.plan.debug.target === 'host' ? 'host local' : 'sandbox isolada'
    const modifiesHost = session.plan.debug.target === 'host' && session.plan.debug.access === 'modify'
    const description = modifiesHost
      ? `Ação de debug com alteração no ${target}: ${session.plan.debug.rationale}`
      : `Probe de observação no ${target}: ${session.plan.debug.rationale}`
    items.push(item(chat, 'debug-approval', 'warning', 'Debug aguarda autorização', description, 'plan', 'approve-debug'))
  }

  switch (session.failure_kind) {
    case 'remote_input_transport':
      if (!humanAction?.active && session.state === 'failed') {
        items.push(item(chat, 'remote-input-transport', 'warning', 'Falha na ligação ao ChatGPT', 'O projeto não falhou. Repita o pedido usando o contexto atual.', 'chatgpt', 'retry-transport', session.last_request_id))
      }
      failureAlertAdded = true
      break
    case 'submodule_write':
      items.push(item(
        chat,
        'submodule-write',
        'danger',
        'Submódulo indisponível para integração',
        session.last_repair_error || 'Inicialize ou repare o checkout Git do submódulo indicado e repita o pedido.',
      ))
      failureAlertAdded = true
      break
    case 'host_build_toolchain_mismatch':
      items.push(item(chat, 'host-toolchain', 'danger', 'Build do host bloqueado', 'A toolchain do host é incompatível com a dependência fixada; requer intervenção local.', 'terminal'))
      failureAlertAdded = true
      break
    case 'host_dependency_state':
      items.push(item(chat, 'host-dependency', 'warning', 'Dependências do host incompletas', 'Reinstale as dependências do host e repita a aplicação verificada.', 'terminal', 'repair-host-dependency'))
      failureAlertAdded = true
      break
    case 'sandbox_preparation_timeout':
      items.push(item(chat, 'sandbox-preparation-timeout', 'warning', 'Preparação do sandbox excedeu o limite', session.last_repair_error || 'A preparação local do sandbox excedeu o tempo do comando antes de o processo iniciar.', 'terminal'))
      failureAlertAdded = true
      break
    case 'offline_go_module_cache':
      // RetryDependencyNetwork only recovers a failure raised by Wharnex's
      // own sandbox execution of a plan (see service_dependency_network.go);
      // per SoT/AI_PROTOCOL.md a `blocked`/`failed` planner turn can never
      // carry a plan, so a planner-reported offline_go_module_cache never has
      // one either. Only offer the retry action when a coherent failed plan
      // actually exists — otherwise leave failureAlertAdded unset so the
      // generic blocked-turn item below surfaces the planner's own message.
      if (session.plan && session.last_execution?.plan_id === session.plan.plan_id) {
        items.push(item(chat, 'dependency-network', 'warning', 'Dependências precisam de rede', 'A execução está parada até autorizar a tentativa restrita com rede.', 'plan', 'retry-dependency-network'))
        failureAlertAdded = true
      }
      break
    default: {
      // Every host-Apply failure that keeps a verified candidate shares one
      // card and one action; only the wording differs (hostApplyAttention).
      const retry = pendingCount ? hostApplyAttention(session) : undefined
      if (retry) {
        items.push(item(chat, 'host-apply-retry', 'warning', retry.title, retry.detail, 'plan', 'retry-host-apply'))
        failureAlertAdded = true
      }
    }
  }

  // A live Desktop human-action block already names the real transport or
  // authentication problem. A second GPT-repair card would describe the same
  // stopped request as a source defect and offer a competing recovery.
  const guidanceRequired = plannerDeclaredNonRetryable(session)
  const repairKind = !session.failure_kind || session.failure_kind === PLANNER_GUIDANCE_REQUIRED
  const repairableFailure = !humanAction?.active && repairKind && session.state === 'failed' && Boolean(session.last_repair_error || (session.last_execution?.success === false && session.last_execution.error))
  const preparedRepair = !humanAction?.active && repairKind && session.state === 'repair_pending' && Boolean(session.last_manual_prompt)
  if (!failureAlertAdded && (repairableFailure || preparedRepair)) {
    items.push(item(chat, 'gpt-repair', 'warning', guidanceRequired ? 'Nova evidência necessária' : preparedRepair ? 'Correção GPT pronta para enviar' : 'Erro reparável com GPT', guidanceRequired ? 'O GPT indicou que repetir sem informação nova não resolverá o bloqueio. Acrescente evidência ou orientação antes de iniciar outra tentativa.' : preparedRepair ? 'A correção automática foi preparada; pode reenviá-la manualmente e acrescentar um detalhe.' : 'A tentativa automática terminou; pode iniciar uma correção manual e acrescentar um detalhe.', 'chatgpt', 'repair-with-gpt'))
    failureAlertAdded = true
  }

  if (canExecute && sessionNeedsExecutionConsent(session)) {
    const approval = session.policy?.approval_items?.find((candidate) => candidate.requires_sudo_password) || session.policy?.approval_items?.find((candidate) => candidate.argv?.length) || session.policy?.approval_items?.[0]
    const command = approval?.argv?.length ? JSON.stringify(approval.argv) : ''
    const approvalType = approval?.requires_sudo_password ? 'sudo + senha' : approval?.kind
    const detail = command
      ? `Aprovação de execução ${approvalType ? `(${approvalType}) ` : ''}necessária para: ${command}`
      : `Plano pronto para executar · risco ${session.policy?.risk || session.plan?.risk || 'desconhecido'}.`
    items.push(item(chat, 'approval-required', 'warning', 'Aprovação necessária', detail, 'plan', 'approve-execution'))
  } else if (session.plan && session.policy && !session.policy.allowed) {
    items.push(item(chat, 'policy-blocked', 'danger', 'Plano bloqueado pela Policy', session.policy.reasons?.[0] || 'Revise o plano antes de executar.', 'plan'))
  }


  const completionReady = Boolean(session.last_host_applied_at && !session.pending_knowledge_review_request_id)
  if (session.self_evolution_activation === 'restart_pending' && completionReady) {
    items.push(item(
      chat,
      `restart-pending:${session.last_host_applied_at}`,
      'success',
      'Auto-evolução concluída',
      'Alterações aplicadas e construídas. Clique para rever o lote acumulado e escolher a ativação.',
      undefined,
      undefined,
      session.last_request_id,
      'restart-pending',
      session.last_host_applied_at,
    ))
  } else if (!session.self_evolution && completionReady) {
    items.push(item(
      chat,
      `task-completed:${session.last_host_applied_at}`,
      'success',
      'Tarefa concluída',
      'Execução e integração no host concluídas com sucesso.',
      undefined,
      undefined,
      session.last_request_id,
      'task-completed',
      session.last_host_applied_at,
    ))
  }
  if (session.last_turn?.kind === 'clarification' && session.state === 'awaiting_clarification') {
    items.push(item(chat, 'clarification', 'warning', 'Resposta necessária', session.last_turn.message || 'O pedido aguarda um esclarecimento para continuar.'))
  } else if (session.last_turn?.kind === 'blocked' && (session.state === 'blocked' || session.state === 'failed') && !(session.plan && session.policy && !session.policy.allowed) && !failureAlertAdded) {
    items.push(item(chat, 'turn-blocked', 'danger', 'Pedido bloqueado', session.last_turn.message || 'O pedido não pode continuar sem intervenção.'))
  }

  return items
}

function item(chat: WorkspaceChat, suffix: string, tone: AttentionTone, title: string, detail: string, target?: AttentionTarget, action?: AttentionAction, requestId?: string, kind?: AttentionKind, occurredAt?: string): AttentionItem {
  return { id: `${chat.id}:${suffix}`, chatId: chat.id, chatTitle: chat.title, title, detail, tone, target, action, requestId, kind, occurredAt }
}

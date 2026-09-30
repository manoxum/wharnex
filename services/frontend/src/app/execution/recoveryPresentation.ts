import type { Session } from '../../types'
import { type WorkspaceChat } from '../../lib/chat/history/workspaceMemory'
import { buildChangeSummary } from '../../lib/execution/recovery/changeSummary'
import { PLANNER_GUIDANCE_REQUIRED } from '../../lib/execution/recovery/plannerRecovery'

export function canRetryDependencyNetwork(session: Session) {
  return session.failure_kind === 'offline_go_module_cache' && Boolean(session.plan && session.last_execution?.plan_id === session.plan.plan_id)
}

export function canRepairFailureWithGPT(session: Session) {
  if ((session.failure_kind && session.failure_kind !== PLANNER_GUIDANCE_REQUIRED) || (session.plan && session.policy && !session.policy.allowed)) return false
  if (session.state === 'repair_pending') return Boolean(session.last_manual_prompt)
  return session.state === 'failed' && Boolean(session.last_repair_error || (session.last_execution?.success === false && session.last_execution.error))
}

export function recoveryHumanAction(chat: WorkspaceChat, actions: Record<string, DesktopChatGPTHumanAction>) {
  const keys = [chat.id]
  return keys.map((key) => actions[key]).find((action) => action?.active)
}

export function buildAppliedChangeSummary(session: Session) {
  return buildChangeSummary(appliedSummaryPlan(session), session.last_host_applied_at || new Date().toISOString(), session.last_host_commands || [])
}

export function appliedSummaryPlan(session: Session) {
  const applied = session.last_applied_changes || []
  if (!applied.length) return session.plan
  const latest = applied[applied.length - 1].plan
  return {
    ...latest,
    summary: applied.map((change) => change.plan.summary).filter(Boolean).join(' + '),
    operations: applied.flatMap((change) => change.plan.operations || []),
    verification: applied.flatMap((change) => change.plan.verification || []),
  }
}

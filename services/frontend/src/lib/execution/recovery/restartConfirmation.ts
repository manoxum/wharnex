import type { ActivationImpact, ChatChangeSummary, Session } from '../../../types'

export type RestartReport = {
  sessionId: string
  chatId: string
  chatTitle: string
  change?: ChatChangeSummary
  impacts: ActivationImpact[]
}

const IMPACT_ORDER: ActivationImpact[] = ['backend', 'frontend', 'desktop', 'tunnel']

export function isRestartPending(session?: Session) {
  return Boolean(session?.self_evolution && (
    session.self_evolution_activation === 'restart_pending' ||
    (!session.self_evolution_activation && session.state === 'restart_pending')
  ))
}

export function isRestartConfirmationReady(session?: Session) {
  return Boolean(isRestartPending(session) && !session?.pending_knowledge_review_request_id)
}

export function restartConfirmationKey(session?: Session) {
  if (!session || !isRestartConfirmationReady(session)) return undefined
  const applied = session.last_applied_changes || []
  const planId = applied[applied.length - 1]?.plan.plan_id || session.plan?.plan_id || 'pending'
  return `${session.id}:${planId}`
}

export function mergeRestartImpacts(reports: RestartReport[]): ActivationImpact[] {
  const impacts = new Set(reports.flatMap((report) => report.impacts))
  return IMPACT_ORDER.filter((impact) => impacts.has(impact))
}

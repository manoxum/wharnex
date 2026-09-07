import type { Session } from '../types'

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

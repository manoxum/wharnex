import type { Session } from '../../../types'

// `running` is the durable intent recorded before every ordinary execution.
// It becomes a recovery state only after backend restart, where persisted
// running/resuming intents are normalized to awaiting_decision. Seeing a live
// `running` intent while refreshing another chat must not manufacture an
// "Execução interrompida" notification.
export function executionNeedsAttention(session?: Session): session is Session & { interrupted_execution: NonNullable<Session['interrupted_execution']> } {
  const intent = session?.interrupted_execution
  return Boolean(intent && intent.status !== 'running')
}

export function sessionCanExecutePlan(session: Session) {
  const planID = session.plan?.plan_id
  const pendingSamePlan = Boolean(planID && session.interrupted_execution?.plan_id === planID)
  return Boolean(session.plan && session.policy?.allowed && ['planned', 'failed'].includes(session.state) && session.last_turn?.kind !== 'workflow' && !pendingSamePlan)
}

export function sessionNeedsExecutionConsent(session: Session) {
  if (!session.plan) return false
  if (session.execution_mode === 'unprotected') return true
  if (session.policy?.requires_approval) {
    if (session.execution_mode !== 'full') return true
    const items = session.policy.approval_items || []
    if (!items.length || items.some((item) => !item.bypass_in_full)) return true
  }
  if (!session.plan.document?.trim()) return false
  const lineage = session.request_lineages?.[session.plan.request_id]
  return session.execution_mode === 'protected' && (!lineage || lineage.kind === 'standard')
}

export function sessionCanApproveDebug(session: Session) {
  return Boolean(session.state === 'debug_approval_required' && session.plan?.debug && session.plan.status === 'ready' && session.policy?.allowed && session.interrupted_execution?.plan_id !== session.plan.plan_id)
}

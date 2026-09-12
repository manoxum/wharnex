import type { Session } from '../types'

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

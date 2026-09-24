import type { Session } from '../types'

const ACTIVE_REQUEST_STATES = new Set([
  'awaiting_plan',
  'awaiting_plan_approval',
  'workflow_pending',
  'workflow_planned',
  'workflow_observed',
  'debug_approval_required',
  'repair_pending',
  'planned',
  'baseline_update_pending',
  'conflict_resolution_pending',
  'restart_scheduled',
])

export function requestChainActive(session: Session) {
  if (session.planner_in_flight || session.pending_manual_request_ids?.length) return true
  if (session.self_evolution_activation === 'restart_scheduled') return true
  return ACTIVE_REQUEST_STATES.has(session.state)
}

export function knowledgeConsolidationPending(session: Session) {
  const requestId = String(session.last_request_id || '').trim()
  if (!requestId || session.request_lineages?.[requestId]?.kind !== 'knowledge_consolidation') return false
  return Boolean(session.planner_in_flight || session.pending_manual_request_ids?.includes(requestId))
}

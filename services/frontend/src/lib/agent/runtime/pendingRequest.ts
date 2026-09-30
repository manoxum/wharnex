import type { Session } from '../../../types'

const pendingStates = new Set(['awaiting_plan', 'workflow_pending', 'repair_pending', 'baseline_update_pending', 'conflict_resolution_pending'])

export function sessionHasPendingRequest(session: Session, requestId: string) {
  const id = String(requestId || '').trim()
  if (!id) return false
  if (session.pending_manual_request_ids?.includes(id)) return true
  return session.last_request_id === id && pendingStates.has(session.state)
}

/** Locate the durable owner of a response, including an already accepted
 * request whose renderer acknowledgement was interrupted. */
export function sessionOwnsRequest(session: Session, requestId: string) {
  const id = String(requestId || '').trim()
  if (!id) return false
  if (sessionHasPendingRequest(session, id) || session.last_request_id === id) return true
  if (session.request_lineages?.[id]) return true
  return Boolean(session.artifacts?.some((artifact) => artifact.request_id === id))
}

/** One ChatGPT surface has one authoritative request identity at a time. */
export function activePendingRequestId(session: Session) {
  const conflict = String(session.integration_conflict?.request_id || '').trim()
  if (conflict && sessionHasPendingRequest(session, conflict)) return conflict
  const knowledge = String(session.pending_knowledge_review_request_id || '').trim()
  if (knowledge && sessionHasPendingRequest(session, knowledge)) return knowledge
  const latest = String(session.last_request_id || '').trim()
  if (latest && sessionHasPendingRequest(session, latest)) return latest
  const unambiguous = (session.pending_manual_request_ids || []).map((id) => String(id || '').trim()).filter(Boolean)
  if (unambiguous.length === 1) return unambiguous[0]
  return ''
}

export function pendingRequestRecoveryPrompt(session: Session, requestId: string) {
  const id = String(requestId || '').trim()
  if (!id || activePendingRequestId(session) !== id) return ''
  if (id !== session.last_request_id && id !== session.pending_knowledge_review_request_id && id !== session.integration_conflict?.request_id) return ''
  return session.last_manual_prompt || ''
}

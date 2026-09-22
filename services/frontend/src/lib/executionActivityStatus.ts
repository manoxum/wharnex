import type { Session } from '../types'
import type { ExecutionTimelineEntry, ExecutionTimelineOverview } from './executionTimeline'
import { mainRequestRoot } from './projectActivity'

/** The durable root that owns the latest request known by the session. */
export function currentMainRequestRoot(session: Session) {
  const requestId = String(session.last_request_id || '').trim()
  return mainRequestRoot(session, requestId)
}

/**
 * Resolve the visible state of one execution timeline.
 *
 * A started command/repair can be left without its matching terminal event
 * after a crash or interrupted transport. That evidence remains valuable, but
 * it must not keep an older Main Request labelled as actively executing. A
 * later terminal lifecycle result also outranks an earlier orphaned RUN entry.
 */
export function executionActivityOverview(entries: ExecutionTimelineEntry[], allowActive = true): ExecutionTimelineOverview {
  let latestActiveIndex = -1
  let latestTerminal: { index: number; state: 'success' | 'failure' } | undefined
  let hadFailure = false

  entries.forEach((entry, index) => {
    if (entry.running || entry.lifecycleState === 'active') latestActiveIndex = index
    if (entry.lifecycleState === 'failure') {
      hadFailure = true
      latestTerminal = { index, state: 'failure' }
    } else if (entry.lifecycleState === 'success') {
      latestTerminal = { index, state: 'success' }
    }
  })

  if (allowActive && latestActiveIndex > (latestTerminal?.index ?? -1)) return 'active'
  if (latestTerminal?.state === 'failure') return 'failed'
  if (latestTerminal?.state === 'success') return hadFailure ? 'recovered' : 'success'
  if (allowActive && latestActiveIndex >= 0) return 'active'
  return 'neutral'
}

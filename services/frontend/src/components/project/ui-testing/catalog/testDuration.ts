import type { UITestRun } from '../../../../types'

export function testDuration(run?: UITestRun) {
  if (!run?.completed_at) return ''
  const elapsed = Date.parse(run.completed_at) - Date.parse(run.started_at)
  if (!Number.isFinite(elapsed) || elapsed < 0) return ''
  return elapsed < 1000 ? `${elapsed} ms` : `${(elapsed / 1000).toFixed(1)} s`
}

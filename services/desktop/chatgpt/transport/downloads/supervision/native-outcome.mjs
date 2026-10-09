const REASONS = new Set(['accepted', 'selection-kind', 'selection-not-ready', 'url-unavailable', 'expectation', 'slot', 'loading', 'login', 'preparing', 'manual', 'human-gate', 'queued-comment', 'pending-delivery', 'already-delivered', 'expired', 'affinity', 'supervisor-lease', 'owned-entry', 'webcontents', 'url-changed', 'origin', 'input-unavailable', 'target-kind', 'target-viewport', 'target-point', 'input-unconfirmed', 'exception'])
const STAGES = new Set(['selection', 'initial', 'focus', 'locate', 'before-input', 'input', 'complete'])
const TARGET_REASONS = new Set(['ready', 'exact-unavailable', 'geometry-unavailable', 'point-outside-viewport', 'covered-control'])
export function normalizeNativeDownloadOutcome(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const target = source.target || {}
  const number = (value) => Number.isFinite(value) ? Math.max(-1_000_000, Math.min(1_000_000, Math.round(value))) : null
  const dimensions = (value, fields) => Object.fromEntries(fields.map((field) => [field, number(value?.[field])]))
  return {
    accepted: source.accepted === true,
    reason: REASONS.has(source.reason) ? source.reason : 'exception',
    stage: STAGES.has(source.stage) ? source.stage : 'initial',
    target: {
      reason: TARGET_REASONS.has(target.reason) ? target.reason : 'exact-unavailable',
      scrolled: target.scrolled === true,
      viewport: dimensions(target.viewport, ['width', 'height']),
      bounds: dimensions(target.bounds, ['left', 'top', 'width', 'height']),
      point: dimensions(target.point || target.rect, ['x', 'y']),
      hit: { tag: String(target.hit?.tag || '').slice(0, 32), role: String(target.hit?.role || '').slice(0, 32), matchesTarget: target.hit?.matchesTarget === true, missing: target.hit?.missing === true },
    },
  }
}

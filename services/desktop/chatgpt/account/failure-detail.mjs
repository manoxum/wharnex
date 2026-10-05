// Renders an account-operation failure as a durable, self-describing diagnostic.
//
// Only the SHAPE of the page is recorded — viewport dimensions and control
// counts — never the text of any control, which `SoT/OBSERVABILITY.md` keeps out
// of logs, events and IPC. A bare `action-offscreen` cannot be told apart from a
// slot that simply has no layout viewport, and that is exactly what let dozens
// of identical ORGANIZE_CHAT failures accumulate carrying nothing actionable.
export function accountFailureDetail(result) {
  const state = String(result?.state || 'unknown')
  const parts = []
  const viewport = result?.viewport
  if (Number.isFinite(viewport?.w) && Number.isFinite(viewport?.h)) parts.push(`viewport=${viewport.w}x${viewport.h}`)
  const counts = [
    ['items', Array.isArray(result?.available) ? result.available.length : undefined],
    ['anchors', result?.count],
    ['rows', result?.rows],
    ['matches', result?.matches],
    ['duplicates', result?.duplicates],
  ]
  for (const [name, value] of counts) if (Number.isFinite(value)) parts.push(`${name}=${value}`)
  return parts.length ? `${state} (${parts.join(' ')})` : state
}

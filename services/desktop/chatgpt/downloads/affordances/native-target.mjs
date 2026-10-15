import { inspectExactRoleLink } from './role-link.mjs'

export function locateExactRoleLinkPoint(document, node, expected, inspect) {
  const target = { kind: 'exact-role-link', rect: null, reason: 'exact-unavailable', scrolled: false, viewport: { width: Number(document.defaultView?.innerWidth || 0), height: Number(document.defaultView?.innerHeight || 0) } }
  const main = document.querySelector?.('main')
  const valid = () => Boolean(node) && node.isConnected !== false && inspect(node, 0, expected, main, [node], true).metadata === expected
  if (!valid()) return target
  const point = () => { const rect = node.getBoundingClientRect?.(); target.bounds = { left: rect?.left, top: rect?.top, width: rect?.width, height: rect?.height }; return rect?.width > 0 && rect?.height > 0 ? { x: Math.floor(rect.left + rect.width / 2), y: Math.floor(rect.top + rect.height / 2) } : null }
  const inViewport = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x < target.viewport.width && p.y < target.viewport.height
  let rect = point()
  if (!inViewport(rect)) { target.scrolled = true; node.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'instant' }); rect = point() }
  target.point = rect
  if (!valid()) return target
  if (!inViewport(rect)) { target.reason = rect ? 'point-outside-viewport' : 'geometry-unavailable'; return target }
  const hit = document.elementFromPoint?.(rect.x, rect.y)
  target.hit = { tag: String(hit?.tagName || '').slice(0, 32), role: String(hit?.getAttribute?.('role') || '').slice(0, 32), missing: !hit, matchesTarget: hit === node || Boolean(node.contains?.(hit)) }
  if (!target.hit.matchesTarget) { target.reason = 'covered-control'; return target }
  target.reason = 'ready'
  target.rect = rect
  return target
}

function locateLatest(document, expected, inspect, point) {
  const main = document.querySelector?.('main')
  const excluded = '[data-message-author-role="user"], [class~="group/user-message"], form[data-chatgpt-composer], [data-composer-surface], nav, aside'
  const nodes = [...document.querySelectorAll('[role="link"]')].filter((node) => main?.contains?.(node) && !node.closest?.(excluded)).slice(0, 128)
  const selected = [...nodes].reverse().find((node) => inspect(node, 0, expected, main, nodes, true).metadata === expected)
  return point(document, selected, expected, inspect)
}

// Named main-owned expectation lookup; no renderer-controlled script or selector.
export function chatGPTExactRoleLinkTargetScript(filename) {
  return `(() => { const inspect=${inspectExactRoleLink.toString()}; const point=${locateExactRoleLinkPoint.toString()}; const locate=${locateLatest.toString()}; return locate(document,${JSON.stringify(String(filename || ''))},inspect,point); })()`
}

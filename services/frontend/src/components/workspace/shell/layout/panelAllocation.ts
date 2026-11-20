import type { Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'

type Panel = { tool: Drawer; preferred: number }
type PanelBounds = { min: number; max: number }
export function supportingPanelBounds(tool: Drawer): PanelBounds {
  if (tool === 'project') return { min: 200, max: 420 }
  if (tool === 'git') return { min: 320, max: 560 }
  if (tool === 'docker' || tool === 'database') return { min: 320, max: 720 }
  if (tool === 'agents' || tool === 'external-agents') return { min: 300, max: 640 }
  return { min: 260, max: 560 }
}
export function primaryWorkspaceReserve(width: number) { return Math.min(560, Math.max(360, Math.round(width * 0.42))) }

// Both activity rails reserve 48px, including when a drawer overlays the editor.
export function supportingOverlayWidth(width: number, preferred: number, tool: Drawer) {
  const bounds = supportingPanelBounds(tool)
  return Math.max(0, Math.min(Math.max(preferred, bounds.min), bounds.max, width - 96))
}

// Projection only: the caller keeps the original preferred geometry in storage.
export function allocateSupportingPanels(width: number, chrome: number, left?: Panel, right?: Panel, priority?: 'left' | 'right') {
  const reserve = primaryWorkspaceReserve(width)
  const bounds = (panel?: Panel) => panel ? supportingPanelBounds(panel.tool) : { min: 0, max: 0 }
  const lb = bounds(left), rb = bounds(right)
  let l = left ? Math.max(lb.min, Math.min(lb.max, left.preferred)) : 0
  let r = right ? Math.max(rb.min, Math.min(rb.max, right.preferred)) : 0
  const budget = Math.max(0, width - chrome - reserve)
  const rightOverlay = Boolean(right && left && lb.min + rb.min > budget)
  if (rightOverlay) r = Math.min(r, Math.max(rb.min, width - chrome))
  const total = l + (rightOverlay ? 0 : r)
  if (total > budget) {
    if (priority === 'left') {
      l = Math.min(l, Math.max(lb.min, budget - (rightOverlay ? 0 : rb.min)))
      if (!rightOverlay) r = Math.min(r, Math.max(rb.min, budget - l))
    } else if (priority === 'right' && !rightOverlay) {
      r = Math.min(r, Math.max(rb.min, budget - lb.min))
      l = Math.min(l, Math.max(lb.min, budget - r))
    } else {
      const reducibleLeft = Math.max(0, l - lb.min)
      const reducibleRight = rightOverlay ? 0 : Math.max(0, r - rb.min)
      const reducible = reducibleLeft + reducibleRight
      const reduction = Math.min(reducible, total - budget)
      if (reducible) {
        l -= reduction * reducibleLeft / reducible
        if (!rightOverlay) r -= reduction * reducibleRight / reducible
      }
    }
  }
  return { left: Math.round(l), right: Math.round(r), rightOverlay }
}

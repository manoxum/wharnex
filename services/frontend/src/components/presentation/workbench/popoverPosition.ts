export type PopoverAnchor = { left: number; right: number; top: number; bottom: number }
export type PopoverSize = { width: number; height: number }
export type PopoverViewport = { width: number; height: number }
export type PopoverPlacement = { top: number; left: number; maxHeight: number; side: 'top' | 'bottom' }
export type PopoverPositionState = PopoverPlacement & { fontScale: string }
export type PopoverAlignment = 'start' | 'end'

const VIEWPORT_GUTTER = 8
const TRIGGER_GAP = 6

export function positionPopover(anchor: PopoverAnchor, panel: PopoverSize, viewport: PopoverViewport, alignment: PopoverAlignment = 'start'): PopoverPlacement {
  const width = Math.min(panel.width, Math.max(0, viewport.width - VIEWPORT_GUTTER * 2))
  const maxLeft = Math.max(VIEWPORT_GUTTER, viewport.width - width - VIEWPORT_GUTTER)
  const requestedLeft = alignment === 'end' ? anchor.right - width : anchor.left
  const left = Math.max(VIEWPORT_GUTTER, Math.min(requestedLeft, maxLeft))
  const above = Math.max(0, anchor.top - VIEWPORT_GUTTER - TRIGGER_GAP)
  const below = Math.max(0, viewport.height - anchor.bottom - VIEWPORT_GUTTER - TRIGGER_GAP)
  const side = panel.height > below && above > below ? 'top' : 'bottom'
  const available = side === 'top' ? above : below
  const maxHeight = Math.min(Math.max(0, viewport.height - VIEWPORT_GUTTER * 2), available)
  const visibleHeight = Math.min(panel.height, maxHeight)
  const top = side === 'top'
    ? Math.max(VIEWPORT_GUTTER, anchor.top - TRIGGER_GAP - visibleHeight)
    : Math.min(viewport.height - VIEWPORT_GUTTER - visibleHeight, anchor.bottom + TRIGGER_GAP)
  return { top, left, maxHeight, side }
}

export function samePopoverPosition(current: PopoverPositionState, next: PopoverPositionState): boolean {
  return current.top === next.top && current.left === next.left && current.maxHeight === next.maxHeight
    && current.side === next.side && current.fontScale === next.fontScale
}

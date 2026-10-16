type Anchor = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>

type Viewport = { width: number; height: number }

export type ModelPopoverPlacement = {
  className: string
  minWidth: number
  maxWidth: number
  maxHeight: number
}

const EDGE_GUTTER = 8
const POPOVER_GAP = 4
const TARGET_WIDTH = 288
const MIN_WIDTH = 192
const TARGET_HEIGHT = 256

export function modelPopoverPlacement(anchor: Anchor, viewport: Viewport): ModelPopoverPlacement {
  const leftRoom = Math.max(0, viewport.width - EDGE_GUTTER - anchor.left)
  const rightRoom = Math.max(0, anchor.right - EDGE_GUTTER)
  const alignLeft = leftRoom >= TARGET_WIDTH || leftRoom >= rightRoom
  const widthRoom = alignLeft ? leftRoom : rightRoom
  const maxWidth = Math.min(TARGET_WIDTH, widthRoom)

  const belowRoom = Math.max(0, viewport.height - anchor.bottom - EDGE_GUTTER - POPOVER_GAP)
  const aboveRoom = Math.max(0, anchor.top - EDGE_GUTTER - POPOVER_GAP)
  const openAbove = belowRoom < TARGET_HEIGHT && aboveRoom > belowRoom
  const heightRoom = openAbove ? aboveRoom : belowRoom

  return {
    className: `${openAbove ? 'bottom-full mb-1' : 'top-full mt-1'} ${alignLeft ? 'left-0' : 'right-0'}`,
    minWidth: Math.min(MIN_WIDTH, maxWidth),
    maxWidth,
    maxHeight: Math.min(TARGET_HEIGHT, heightRoom),
  }
}

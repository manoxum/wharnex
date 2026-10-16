import { describe, expect, it } from 'vitest'
import { positionPopover, samePopoverPosition } from './popoverPosition'

describe('positionPopover', () => {
  it('keeps a menu attached to the trigger and inside horizontal viewport bounds', () => {
    expect(positionPopover({ left: 12, right: 40, top: 140, bottom: 172 }, { width: 320, height: 200 }, { width: 800, height: 600 }))
      .toEqual({ top: 178, left: 12, maxHeight: 414, side: 'bottom' })
    expect(positionPopover({ left: 760, right: 792, top: 140, bottom: 172 }, { width: 320, height: 200 }, { width: 800, height: 600 }).left)
      .toBe(472)
  })

  it('aligns trailing controls to the end of the popover', () => {
    expect(positionPopover({ left: 600, right: 632, top: 140, bottom: 172 }, { width: 320, height: 200 }, { width: 800, height: 600 }, 'end'))
      .toEqual({ top: 178, left: 312, maxHeight: 414, side: 'bottom' })
  })

  it('opens above a low trigger when that side has more room', () => {
    expect(positionPopover({ left: 90, right: 120, top: 530, bottom: 562 }, { width: 280, height: 400 }, { width: 800, height: 600 }))
      .toEqual({ top: 124, left: 90, maxHeight: 516, side: 'top' })
  })

  it('caps the menu to the available viewport even when neither side fits', () => {
    const result = positionPopover({ left: 12, right: 40, top: 31, bottom: 39 }, { width: 600, height: 300 }, { width: 240, height: 80 })
    expect(result.left).toBe(8)
    expect(result.top).toBeGreaterThanOrEqual(8)
    expect(result.maxHeight).toBeLessThanOrEqual(27)
    expect(result.side).toBe('bottom')
  })

  it('treats unchanged geometry and font scale as a stable placement', () => {
    const position = { top: 40, left: 80, maxHeight: 300, side: 'bottom' as const, fontScale: '1.1' }
    expect(samePopoverPosition(position, { ...position })).toBe(true)
    expect(samePopoverPosition(position, { ...position, top: 41 })).toBe(false)
    expect(samePopoverPosition(position, { ...position, fontScale: '1.2' })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { modelPopoverPlacement } from './modelPopoverPlacement'

describe('ChatGPT model menu placement', () => {
  it('opens below the trigger when the viewport has room', () => {
    expect(modelPopoverPlacement({ top: 180, bottom: 212, left: 120, right: 300 }, { width: 1000, height: 800 })).toEqual({
      className: 'top-full mt-1 left-0', minWidth: 192, maxWidth: 288, maxHeight: 256,
    })
  })

  it('opens above a low trigger and caps the menu to the available height', () => {
    expect(modelPopoverPlacement({ top: 520, bottom: 552, left: 100, right: 250 }, { width: 900, height: 620 })).toEqual({
      className: 'bottom-full mb-1 left-0', minWidth: 192, maxWidth: 288, maxHeight: 256,
    })
  })

  it('aligns to the viewport edge when the trigger is near the right edge', () => {
    expect(modelPopoverPlacement({ top: 100, bottom: 132, left: 760, right: 800 }, { width: 820, height: 600 })).toEqual({
      className: 'top-full mt-1 right-0', minWidth: 192, maxWidth: 288, maxHeight: 256,
    })
  })

  it('shrinks inside a compact window without imposing an overflowing minimum', () => {
    const placement = modelPopoverPlacement({ top: 60, bottom: 88, left: 75, right: 115 }, { width: 180, height: 130 })
    expect(placement.className).toBe('bottom-full mb-1 right-0')
    expect(placement.minWidth).toBe(107)
    expect(placement.maxWidth).toBe(107)
    expect(placement.maxHeight).toBe(48)
  })
})

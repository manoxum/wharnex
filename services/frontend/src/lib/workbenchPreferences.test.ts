import { beforeEach, describe, expect, it } from 'vitest'
import { WORKBENCH_SIDE_PANEL_MIN_PX } from './workbenchResize'
import { DEFAULT_WORKBENCH_STATE, defaultSidePanelWidth, loadWorkbenchState, normalizeWorkbenchState, saveWorkbenchState } from './workbenchPreferences'

describe('workbenchPreferences', () => {
  beforeEach(() => localStorage.clear())

  it('persists panel visibility and geometry per project', () => {
    saveWorkbenchState('/projects/a', {
      version: 1,
      left: { open: true, collapsed: false, size: 380, tool: 'project' },
      right: { open: true, collapsed: false, size: 520, tool: 'database' },
      bottom: { open: true, collapsed: false, size: 330 },
    })
    expect(loadWorkbenchState('/projects/a').left).toEqual({ open: true, collapsed: false, size: 380, tool: 'project' })
    expect(loadWorkbenchState('/projects/a').bottom.size).toBe(330)
    const fresh = loadWorkbenchState('/projects/b')
    expect({ ...fresh, left: { ...fresh.left, size: 0 }, right: { ...fresh.right, size: 0 } })
      .toEqual({ ...DEFAULT_WORKBENCH_STATE, left: { ...DEFAULT_WORKBENCH_STATE.left, size: 0 }, right: { ...DEFAULT_WORKBENCH_STATE.right, size: 0 } })
  })

  // Opening both side panels must land on 20% / 60% / 20% of the workbench,
  // keeping the centre visually dominant while preserving equal side drawers.
  it('opens both side panels around a 20/60/20 workbench split', () => {
    expect(defaultSidePanelWidth(1920)).toBe(Math.round((1920 - 100) * 0.20))
    expect(defaultSidePanelWidth(3840)).toBe(Math.round((3840 - 100) * 0.20))
    // Centre keeps the other three fifths, give or take the rounding of one pixel.
    const usable = 1920 - 100
    expect(Math.abs((usable - defaultSidePanelWidth(1920) * 2) - usable * 0.6)).toBeLessThanOrEqual(1)
    expect(defaultSidePanelWidth(0)).toBe(0)
  })

  // A width accepted by the live splitter must survive persistence. The old
  // 45vw/static ceiling silently reduced a wide drawer after reload.
  it('preserves a splitter-accepted wide panel instead of reapplying a 45vw cap', () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 })
    try {
      const wide = normalizeWorkbenchState({ right: { open: true, collapsed: false, size: 1500 } })
      expect(wide.right.size).toBe(1500)
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })


  it('migrates the legacy drawer widths when no workbench state exists yet', () => {
    localStorage.setItem('whx.workspace.drawer-width:left:web', '410')
    localStorage.setItem('whx.workspace.drawer-width:right:web', '590')
    const migrated = loadWorkbenchState('/projects/a')
    expect(migrated.left.size).toBe(410)
    expect(migrated.right.size).toBe(590)
  })

  it('normalizes invalid sizes and tools without leaking malformed local state', () => {
    const normalized = normalizeWorkbenchState({ left: { open: true, collapsed: false, size: 10, tool: 'nope' as never }, bottom: { open: true, collapsed: false, size: 5000 } })
    expect(normalized.left.size).toBe(WORKBENCH_SIDE_PANEL_MIN_PX)
    expect(normalized.left.tool).toBe('')
    expect(normalized.bottom.size).toBe(720)

    const narrowRight = normalizeWorkbenchState({ right: { open: true, collapsed: false, size: 180, tool: 'database' } })
    expect(narrowRight.right.size).toBe(180)
  })
})

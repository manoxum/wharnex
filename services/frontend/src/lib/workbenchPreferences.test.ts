import { beforeEach, describe, expect, it } from 'vitest'
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

  // Opening both side panels must land on 25% / 50% / 25% of the workbench,
  // not on a fixed pixel width that means a different share on every screen.
  it('opens each side panel at a quarter of the workbench', () => {
    expect(defaultSidePanelWidth(1920)).toBe(Math.round((1920 - 54) * 0.25))
    expect(defaultSidePanelWidth(3840)).toBe(Math.round((3840 - 54) * 0.25))
    // Centre keeps the other half, give or take the rounding of one pixel.
    const usable = 1920 - 54
    expect(Math.abs((usable - defaultSidePanelWidth(1920) * 2) - usable * 0.5)).toBeLessThanOrEqual(1)
    expect(defaultSidePanelWidth(0)).toBe(0)
  })

  // A static ceiling would stop a wide screen from ever reaching that quarter,
  // and would stop the operator squeezing the centre deliberately.
  it('lets a side panel grow past its static ceiling on a wide screen', () => {
    const wide = normalizeWorkbenchState({ right: { open: true, collapsed: false, size: 1500 } })
    expect(wide.right.size).toBe(Math.max(840, Math.round(window.innerWidth * 0.45)))
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
    expect(normalized.left.size).toBe(240)
    expect(normalized.left.tool).toBe('')
    expect(normalized.bottom.size).toBe(720)
  })
})

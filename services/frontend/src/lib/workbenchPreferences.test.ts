import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKBENCH_STATE, loadWorkbenchState, normalizeWorkbenchState, saveWorkbenchState } from './workbenchPreferences'

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
    expect(loadWorkbenchState('/projects/b')).toEqual(DEFAULT_WORKBENCH_STATE)
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

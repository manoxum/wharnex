import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_RAIL_LAYOUT, loadWorkspaceRailLayout, moveWorkspaceTool, saveWorkspaceRailLayout } from './workspaceRailLayout'

describe('workspaceRailLayout', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the project explorer on the right and pins the terminal at the lower left by default', () => {
    expect(DEFAULT_WORKSPACE_RAIL_LAYOUT.right).toEqual(['project', 'database'])
    expect(DEFAULT_WORKSPACE_RAIL_LAYOUT.pinned.left).toEqual(['terminal'])
    const moved = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'library', 'right', 'database')
    const reordered = moveWorkspaceTool(moved, 'git', 'left', 'todo')
    const pinned = moveWorkspaceTool(reordered, 'knowledge', 'right', undefined, true)
    saveWorkspaceRailLayout(pinned)
    expect(loadWorkspaceRailLayout().right).toEqual(['project', 'library', 'database'])
    expect(loadWorkspaceRailLayout().left.slice(0, 3)).toEqual(['archive', 'git', 'todo'])
    expect(loadWorkspaceRailLayout().pinned.right).toEqual(['knowledge'])
  })

  it('migrates v2 layouts by moving project right and preserving the terminal side as pinned', () => {
    localStorage.setItem('whx.workspace.rail-layout.v2:/projects/a', JSON.stringify({ left: ['database', 'project', 'git'], right: ['library', 'terminal'] }))
    const migrated = loadWorkspaceRailLayout('/projects/a')
    expect(migrated.right.slice(0, 2)).toEqual(['project', 'library'])
    expect(migrated.left.slice(0, 2)).toEqual(['database', 'git'])
    expect(migrated.pinned.right).toEqual(['terminal'])
  })

  it('migrates v3 layouts into the pinned model without moving the project placement', () => {
    localStorage.setItem('whx.workspace.rail-layout.v3', JSON.stringify({ left: ['library', 'terminal'], right: ['database', 'project'] }))
    const migrated = loadWorkspaceRailLayout()
    expect(migrated.right.slice(0, 2)).toEqual(['database', 'project'])
    expect(migrated.pinned.left).toEqual(['terminal'])
  })

  it('keeps the order stable when a tool is dropped on itself', () => {
    const layout = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'library', 'left', 'library')
    expect(layout.left).toEqual(DEFAULT_WORKSPACE_RAIL_LAYOUT.left)
  })

  it('repairs incomplete or duplicated stored layouts without losing tools', () => {
    localStorage.setItem('whx.workspace.rail-layout.v4', JSON.stringify({ left: ['library', 'library'], right: [], pinned: { left: [], right: [] } }))
    const layout = loadWorkspaceRailLayout()
    expect(layout.left.filter((item) => item === 'library')).toHaveLength(1)
    expect(layout.right).toContain('project')
    expect(layout.right).toContain('database')
    expect(layout.pinned.left).toContain('terminal')
    expect(new Set([...layout.left, ...layout.right, ...layout.pinned.left, ...layout.pinned.right]).size).toBe(14)
  })
})

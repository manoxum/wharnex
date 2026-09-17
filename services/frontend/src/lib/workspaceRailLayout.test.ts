import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_RAIL_LAYOUT, loadWorkspaceRailLayout, moveWorkspaceTool, saveWorkspaceRailLayout } from './workspaceRailLayout'

describe('workspaceRailLayout', () => {
  beforeEach(() => localStorage.clear())

  it('puts the canonical project explorer on the right rail and persists custom movement', () => {
    expect(DEFAULT_WORKSPACE_RAIL_LAYOUT.right).toEqual(['project', 'database'])
    const moved = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'library', 'right', 'database')
    const reordered = moveWorkspaceTool(moved, 'git', 'left', 'todo')
    saveWorkspaceRailLayout(reordered)
    expect(loadWorkspaceRailLayout().right).toEqual(['project', 'library', 'database'])
    expect(loadWorkspaceRailLayout().left.slice(0, 3)).toEqual(['archive', 'git', 'todo'])
  })

  it('migrates v2 layouts by moving only the project explorer to the right', () => {
    localStorage.setItem('whx.workspace.rail-layout.v2:/projects/a', JSON.stringify({ left: ['database', 'project', 'git'], right: ['library'] }))
    const migrated = loadWorkspaceRailLayout('/projects/a')
    expect(migrated.right.slice(0, 2)).toEqual(['project', 'library'])
    expect(migrated.left.slice(0, 2)).toEqual(['database', 'git'])
  })

  it('keeps the order stable when a tool is dropped on itself', () => {
    const layout = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'library', 'left', 'library')
    expect(layout.left).toEqual(DEFAULT_WORKSPACE_RAIL_LAYOUT.left)
  })

  it('repairs incomplete or duplicated stored layouts without losing tools', () => {
    localStorage.setItem('whx.workspace.rail-layout.v3', JSON.stringify({ left: ['library', 'library'], right: [] }))
    const layout = loadWorkspaceRailLayout()
    expect(layout.left.filter((item) => item === 'library')).toHaveLength(1)
    expect(layout.right).toContain('project')
    expect(layout.right).toContain('database')
    expect(new Set([...layout.left, ...layout.right]).size).toBe(14)
  })
})

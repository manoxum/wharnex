import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_RAIL_LAYOUT, loadWorkspaceRailLayout, moveWorkspaceTool, saveWorkspaceRailLayout } from './workspaceRailLayout'

describe('workspaceRailLayout', () => {
  beforeEach(() => localStorage.clear())

  it('persists the per-user rail order and moves tools across sides', () => {
    const moved = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'library', 'right', 'database')
    const reordered = moveWorkspaceTool(moved, 'git', 'left', 'project')
    saveWorkspaceRailLayout(reordered)
    expect(loadWorkspaceRailLayout().right).toEqual(['library', 'database'])
    expect(loadWorkspaceRailLayout().left.slice(0, 3)).toEqual(['archive', 'git', 'project'])
  })

  it('keeps the order stable when a tool is dropped on itself', () => {
    const layout = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'library', 'left', 'library')
    expect(layout.left).toEqual(DEFAULT_WORKSPACE_RAIL_LAYOUT.left)
  })

  it('repairs incomplete or duplicated stored layouts without losing tools', () => {
    localStorage.setItem('whx.workspace.rail-layout.v1', JSON.stringify({ left: ['library', 'library'], right: [] }))
    const layout = loadWorkspaceRailLayout()
    expect(layout.left.filter((item) => item === 'library')).toHaveLength(1)
    expect(layout.right).toContain('database')
    expect(new Set([...layout.left, ...layout.right]).size).toBe(13)
  })
})

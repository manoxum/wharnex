import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_RAIL_LAYOUT, WORKBENCH_NAVIGATION_LAYOUT, loadWorkspaceRailLayout, moveWorkspaceTool, saveWorkspaceRailLayout } from './workspaceRailLayout'

describe('workbench navigation defaults and compatibility', () => {
  beforeEach(() => localStorage.clear())
  it('starts with every tool on one grouped launcher and a contextual right side', () => {
    const layout = loadWorkspaceRailLayout()
    expect(layout).toEqual(WORKBENCH_NAVIGATION_LAYOUT)
    expect(layout.left.slice(0, 3)).toEqual(['project', 'git', 'errors'])
    expect(layout.right).toEqual([])
    expect(new Set([...layout.left, ...layout.pinned.left]).size).toBe(15)
  })
  it('preserves the full previous v9 layout, user order, cross-side placement and pinning', () => {
    const previous = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'knowledge', 'right', undefined, true)
    saveWorkspaceRailLayout(previous)
    expect(loadWorkspaceRailLayout('/any-project')).toEqual(previous)
    expect(loadWorkspaceRailLayout().right).toEqual(['project', 'ui-testing', 'docker', 'database'])
    expect(loadWorkspaceRailLayout().pinned.right).toEqual(['knowledge'])
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_RAIL_LAYOUT, loadWorkspaceRailLayout, moveWorkspaceTool, saveWorkspaceRailLayout, subscribeWorkspaceRailLayout } from './workspaceRailLayout'

describe('workspaceRailLayout', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the project explorer on the right and pins the terminal at the lower left by default', () => {
    expect(DEFAULT_WORKSPACE_RAIL_LAYOUT.right).toEqual(['project', 'ui-testing', 'docker', 'database'])
    expect(DEFAULT_WORKSPACE_RAIL_LAYOUT.left).toContain('external-agents')
    expect(DEFAULT_WORKSPACE_RAIL_LAYOUT.pinned.left).toEqual(['terminal'])
    const moved = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'library', 'right', 'database')
    const reordered = moveWorkspaceTool(moved, 'git', 'left', 'todo')
    const pinned = moveWorkspaceTool(reordered, 'knowledge', 'right', undefined, true)
    saveWorkspaceRailLayout(pinned)
    expect(loadWorkspaceRailLayout().right).toEqual(['project', 'ui-testing', 'docker', 'library', 'database'])
    expect(loadWorkspaceRailLayout().left.slice(0, 3)).toEqual(['archive', 'git', 'todo'])
    expect(loadWorkspaceRailLayout().pinned.right).toEqual(['knowledge'])
  })

  it('shares the latest rail arrangement across every project', () => {
    const projectA = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'knowledge', 'right', 'database')
    const projectB = moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'git', 'right', undefined, true)
    saveWorkspaceRailLayout(projectA, '/projects/a')
    expect(loadWorkspaceRailLayout('/projects/b').right).toEqual(['project', 'ui-testing', 'docker', 'knowledge', 'database'])

    saveWorkspaceRailLayout(projectB, '/projects/b')
    expect(loadWorkspaceRailLayout('/projects/a').pinned.right).toEqual(['git'])
  })

  it('notifies mounted workspaces when the shared rail arrangement changes', () => {
    const updates: string[][] = []
    const unsubscribe = subscribeWorkspaceRailLayout((layout) => updates.push(layout.right))
    saveWorkspaceRailLayout(moveWorkspaceTool(DEFAULT_WORKSPACE_RAIL_LAYOUT, 'knowledge', 'right', 'database'), '/projects/a')
    unsubscribe()
    expect(updates).toEqual([['project', 'ui-testing', 'docker', 'knowledge', 'database']])
  })


  it('migrates the shared v7 layout and adds newly introduced tools without losing placement', () => {
    localStorage.setItem('whx.workspace.rail-layout.v7', JSON.stringify({ left: ['archive', 'agents', 'tasks'], right: ['project', 'docker', 'database'], pinned: { left: ['terminal'], right: ['git'] } }))
    const migrated = loadWorkspaceRailLayout()
    expect(migrated.left).toContain('external-agents')
    expect(migrated.left.indexOf('external-agents')).toBeGreaterThan(migrated.left.indexOf('agents'))
    expect(migrated.right).toContain('ui-testing')
    expect(migrated.pinned.right).toEqual(['git'])
  })


  it('migrates the shared v8 layout and adds UI Lab on the default right rail', () => {
    localStorage.setItem('whx.workspace.rail-layout.v8', JSON.stringify({ left: ['archive', 'todo'], right: ['project', 'docker', 'database'], pinned: { left: ['terminal'], right: [] } }))
    const migrated = loadWorkspaceRailLayout()
    expect(migrated.right).toEqual(['project', 'docker', 'database', 'ui-testing'])
  })

  it('migrates the shared v5 layout without losing pinned tools and adds Docker', () => {
    localStorage.setItem('whx.workspace.rail-layout.v5', JSON.stringify({ left: ['archive'], right: ['project', 'database'], pinned: { left: ['terminal'], right: ['git'] } }))
    const migrated = loadWorkspaceRailLayout()
    expect(migrated.right).toContain('docker')
    expect(migrated.pinned.left).toEqual(['terminal'])
    expect(migrated.pinned.right).toEqual(['git'])
  })


  it('migrates the active project scoped v4 layout into the shared layout once', () => {
    localStorage.setItem('whx.workspace.rail-layout.v4:/projects/a', JSON.stringify({ left: ['archive'], right: ['project', 'knowledge', 'database'], pinned: { left: ['terminal'], right: [] } }))
    const migrated = loadWorkspaceRailLayout('/projects/a')
    expect(migrated.right.slice(0, 3)).toEqual(['project', 'knowledge', 'database'])
    expect(loadWorkspaceRailLayout('/projects/b').right.slice(0, 3)).toEqual(['project', 'knowledge', 'database'])
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
    expect(new Set([...layout.left, ...layout.right, ...layout.pinned.left, ...layout.pinned.right]).size).toBe(15)
  })


  it('drops the legacy FIFO rail entry because execution now lives inside Tarefas', () => {
    localStorage.setItem('whx.workspace.rail-layout.v6', JSON.stringify({ left: ['archive', 'fifo', 'tasks'], right: ['project', 'database'], pinned: { left: ['terminal'], right: [] } }))
    const layout = loadWorkspaceRailLayout()
    const tools = [...layout.left, ...layout.right, ...layout.pinned.left, ...layout.pinned.right] as string[]
    expect(tools).toContain('tasks')
    expect(tools).not.toContain('fifo')
  })

  it('drops legacy Planos and Execuções rail entries in favor of Tarefas', () => {
    localStorage.setItem('whx.workspace.rail-layout.v4', JSON.stringify({ left: ['tasks', 'plans', 'executions'], right: ['project', 'database'], pinned: { left: ['terminal'], right: [] } }))
    const layout = loadWorkspaceRailLayout()
    const tools = [...layout.left, ...layout.right, ...layout.pinned.left, ...layout.pinned.right]
    expect(tools).toContain('tasks')
    expect(tools).not.toContain('plans')
    expect(tools).not.toContain('executions')
  })

})

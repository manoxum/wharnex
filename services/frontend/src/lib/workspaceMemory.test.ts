import { beforeEach, describe, expect, it } from 'vitest'
import { clearActiveWorkspace, loadActiveWorkspace, loadRecentWorkspaces, rememberRecent, saveActiveWorkspace } from './workspaceMemory'

describe('workspace memory', () => {
  beforeEach(() => localStorage.clear())

  it('persists active workspace and recent paths', () => {
    saveActiveWorkspace({ sessionId: 's1', projectPath: '/tmp/project', mode: 'agent' })
    expect(loadActiveWorkspace()).toEqual({ sessionId: 's1', projectPath: '/tmp/project', mode: 'agent' })
    expect(loadRecentWorkspaces()).toEqual(['/tmp/project'])
    clearActiveWorkspace()
    expect(loadActiveWorkspace()).toBeUndefined()
    expect(loadRecentWorkspaces()).toEqual(['/tmp/project'])
  })

  it('deduplicates recent workspaces', () => {
    rememberRecent('/tmp/a')
    rememberRecent('/tmp/b')
    rememberRecent('/tmp/a')
    expect(loadRecentWorkspaces()).toEqual(['/tmp/a', '/tmp/b'])
  })
})

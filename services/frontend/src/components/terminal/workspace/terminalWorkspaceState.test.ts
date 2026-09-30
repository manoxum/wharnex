import { beforeEach, describe, expect, it } from 'vitest'
import { expireTerminalWorkspaces, loadTerminalWorkspace, saveTerminalWorkspace } from './terminalWorkspaceState'

describe('terminal workspace persistence', () => {
  beforeEach(() => localStorage.clear())

  it('persists the stable terminal id used to reconnect after a reload', () => {
    saveTerminalWorkspace('/tmp/project', {
      activeID: 1,
      nextID: 2,
      tabs: [{ id: 1, label: 'Terminal 1', terminalID: 'pty_20260924_reconnect', cwd: '.', history: 'ready\r\n', viewportY: 3 }],
    })

    expect(loadTerminalWorkspace('/tmp/project')).toEqual({
      activeID: 1,
      nextID: 2,
      tabs: [{ id: 1, label: 'Terminal 1', terminalID: 'pty_20260924_reconnect', cwd: '.', history: 'ready\r\n', viewportY: 3 }],
    })
  })

  it('forgets terminal sessions in every project when the sidecar expires', () => {
    for (const project of ['/tmp/one', '/tmp/two']) saveTerminalWorkspace(project, { activeID: 1, nextID: 2, tabs: [{ id: 1, label: 'Terminal 1', terminalID: 'pty_old', cwd: '.', history: 'old', viewportY: 0 }] })
    expireTerminalWorkspaces()
    expect(loadTerminalWorkspace('/tmp/one').tabs).toEqual([])
    expect(loadTerminalWorkspace('/tmp/two').tabs).toEqual([])
  })
})

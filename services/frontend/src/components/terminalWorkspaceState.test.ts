import { beforeEach, describe, expect, it } from 'vitest'
import { loadTerminalWorkspace, saveTerminalWorkspace } from './terminalWorkspaceState'

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
})

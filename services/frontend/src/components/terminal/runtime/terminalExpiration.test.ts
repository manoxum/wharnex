import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleExpiredTerminal, isTerminalTransportExit } from './terminalExpiration'
import { observeTerminalGeneration, saveTerminalWorkspace } from '../workspace/terminalWorkspaceState'

describe('terminal daemon generations', () => {
  beforeEach(() => localStorage.clear())

  it('keeps other projects when only one shell expired in the same daemon', () => {
    observeTerminalGeneration('daemon-a')
    saveTerminalWorkspace('/tmp/other', { activeID: 1, nextID: 2, tabs: [] })
    const clearOne = vi.fn()
    expect(handleExpiredTerminal({ status: 410, data: { detail: { generation: 'daemon-a' } } }, clearOne)).toBe(true)
    expect(clearOne).toHaveBeenCalledOnce()
    expect(localStorage.getItem('whx.terminal.workspace.v1:/tmp/other')).not.toBeNull()
  })

  it('forgets every project after the daemon generation changes', () => {
    observeTerminalGeneration('daemon-a')
    saveTerminalWorkspace('/tmp/other', { activeID: 1, nextID: 2, tabs: [] })
    const clearOne = vi.fn()
    expect(handleExpiredTerminal({ status: 410, data: { detail: { generation: 'daemon-b' } } }, clearOne)).toBe(true)
    expect(clearOne).not.toHaveBeenCalled()
    expect(localStorage.getItem('whx.terminal.workspace.v1:/tmp/other')).toBeNull()
  })

  it('forgets all remembered shells when the terminal daemon is unavailable', () => {
    saveTerminalWorkspace('/tmp/other', { activeID: 1, nextID: 2, tabs: [] })
    expect(handleExpiredTerminal({ status: 503, data: { error: { code: 'terminal_daemon_unavailable' } } }, vi.fn())).toBe(true)
    expect(localStorage.getItem('whx.terminal.workspace.v1:/tmp/other')).toBeNull()
  })

  it('reconnects a transport write timeout without treating it as shell exit', () => {
    expect(isTerminalTransportExit({ type: 'exit', code: -1, message: 'host PTY input transport: timeout' })).toBe(true)
    expect(isTerminalTransportExit({ type: 'exit', code: 0 })).toBe(false)
  })
})

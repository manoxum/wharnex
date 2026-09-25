import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { api } from '../lib/api'
import { InteractiveTerminal } from './InteractiveTerminal'

const terminalMock = vi.hoisted(() => ({
  onData: undefined as undefined | ((data: string) => void),
  onResize: undefined as undefined | ((size: { cols: number; rows: number }) => void),
  selection: '',
  paste: vi.fn(),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class Terminal {
    cols = 80
    rows = 24
    buffer = { active: { viewportY: 0 } }
    loadAddon() {}
    open() {}
    write() {}
    writeln() {}
    focus() {}
    dispose() {}
    hasSelection() { return Boolean(terminalMock.selection) }
    getSelection() { return terminalMock.selection }
    paste(data: string) { terminalMock.paste(data) }
    onData(callback: (data: string) => void) { terminalMock.onData = callback; return { dispose() {} } }
    onResize(callback: (size: { cols: number; rows: number }) => void) { terminalMock.onResize = callback; return { dispose() {} } }
    onScroll() { return { dispose() {} } }
    scrollToLine() {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class FitAddon { fit() {} } }))

vi.mock('../lib/api', () => ({
  APIError: class APIError extends Error {},
  api: {
    openTerminal: vi.fn(), terminalInput: vi.fn(), resizeTerminal: vi.fn(), closeTerminal: vi.fn(),
    terminalEventsURL: vi.fn(() => 'http://terminal/events'), resetTerminal: vi.fn(),
  },
}))

vi.mock('../lib/liveEventStream', () => ({ openLiveEventStream: () => new FakeEventSource() }))

class FakeEventSource {
  constructor() { eventSources.push(this) }
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
}

const eventSources: FakeEventSource[] = []

const clipboard = { readText: vi.fn(), writeText: vi.fn() }

const session: Session = {
  id: 'ses-terminal', project_path: '/tmp/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'manual', created_at: new Date().toISOString(),
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/tmp/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
}

describe('InteractiveTerminal PTY', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventSources.length = 0
    terminalMock.onData = undefined; terminalMock.onResize = undefined; terminalMock.selection = ''
    Object.defineProperty(window, 'wharnessDesktop', { configurable: true, value: { clipboard } })
    clipboard.readText.mockResolvedValue('printf "copiado"\n')
    clipboard.writeText.mockResolvedValue({ ok: true })
    vi.mocked(api.openTerminal).mockResolvedValue({ terminal_id: 'pty-1', target: 'host' })
    vi.mocked(api.terminalInput).mockResolvedValue(undefined)
    vi.mocked(api.resizeTerminal).mockResolvedValue(undefined)
    vi.mocked(api.closeTerminal).mockResolvedValue(undefined)
  })

  it('opens a host PTY and sends keyboard data directly to its shell', async () => {
    render(<InteractiveTerminal session={session} height={245} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalledWith('ses-terminal', expect.objectContaining({ cwd: '.', network: false, cols: 80, rows: 24 }), 'host', true))
    terminalMock.onData?.('nano README.md\r')
    await waitFor(() => expect(api.terminalInput).toHaveBeenCalledWith('ses-terminal', 'pty-1', 'nano README.md\r'))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByLabelText('Terminal interactivo')).toBeTruthy()
  })

  it('coalesces typing while one host input request is in flight', async () => {
    let resolveFirst: (() => void) | undefined
    vi.mocked(api.terminalInput)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue(undefined)
    render(<InteractiveTerminal session={session} height={245} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalledTimes(1))

    terminalMock.onData?.('a')
    await waitFor(() => expect(api.terminalInput).toHaveBeenCalledWith('ses-terminal', 'pty-1', 'a'))
    terminalMock.onData?.('b')
    terminalMock.onData?.('c')
    await Promise.resolve()
    expect(api.terminalInput).toHaveBeenCalledTimes(1)

    resolveFirst?.()
    await waitFor(() => expect(api.terminalInput).toHaveBeenCalledTimes(2))
    expect(api.terminalInput).toHaveBeenLastCalledWith('ses-terminal', 'pty-1', 'bc')
  })

  it('does not expose sandbox selection or the redundant host-direct banner', async () => {
    render(<InteractiveTerminal session={session} height={245} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Sandbox' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Host' })).toBeNull()
    expect(screen.queryByText('HOST DIRECTO')).toBeNull()
  })

  it('reconnects by the same stable terminal id without closing it on remount', async () => {
    vi.mocked(api.openTerminal).mockResolvedValue({ terminal_id: 'pty_host_1', target: 'host' })
    const { rerender } = render(<InteractiveTerminal session={session} height={245} reconnectNonce={0} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalledTimes(1))
    rerender(<InteractiveTerminal session={session} height={245} reconnectNonce={1} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalledTimes(2))
    expect(api.openTerminal).toHaveBeenLastCalledWith('ses-terminal', expect.objectContaining({ terminal_id: 'pty_host_1', network: false }), 'host', true)
    expect(api.closeTerminal).not.toHaveBeenCalled()
  })

  it('reattaches a terminal id restored by the workspace after a page reload', async () => {
    render(<InteractiveTerminal session={session} height={245} terminalID="pty_restored_1" onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalledWith('ses-terminal', expect.objectContaining({ terminal_id: 'pty_restored_1' }), 'host', true))
  })

  it('reattaches the same host PTY after the backend event stream restarts', async () => {
    vi.mocked(api.openTerminal).mockResolvedValue({ terminal_id: 'pty_host_restart', target: 'host' })
    render(<InteractiveTerminal session={session} height={245} onError={() => undefined} />)
    await waitFor(() => expect(eventSources).toHaveLength(1))

    eventSources[0].onerror?.()
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalledTimes(2), { timeout: 1500 })
    expect(api.openTerminal).toHaveBeenLastCalledWith('ses-terminal', expect.objectContaining({ terminal_id: 'pty_host_restart' }), 'host', true)
    await waitFor(() => expect(eventSources).toHaveLength(2))
  })

  it('copies selections and pastes clipboard text through desktop shortcuts', async () => {
    render(<InteractiveTerminal session={session} height={245} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalled())
    const root = screen.getByLabelText('Terminal interactivo')
    terminalMock.selection = './bin/promote republish prod'
    fireEvent.keyDown(root, { key: 'C', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('./bin/promote republish prod'))
    fireEvent.keyDown(root, { key: 'V', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(terminalMock.paste).toHaveBeenCalledWith('printf "copiado"\n'))
  })

  it('forwards terminal dimensions to the live PTY', async () => {
    render(<InteractiveTerminal session={session} height={245} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalled())
    terminalMock.onResize?.({ cols: 132, rows: 41 })
    await waitFor(() => expect(api.resizeTerminal).toHaveBeenCalledWith('ses-terminal', 'pty-1', 132, 41))
  })
})

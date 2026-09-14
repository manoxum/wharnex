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

class FakeEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
}

const clipboard = { readText: vi.fn(), writeText: vi.fn() }

const session: Session = {
  id: 'ses-terminal', project_path: '/tmp/demo', state: 'ready', execution_mode: 'protected', automation_mode: 'manual', created_at: new Date().toISOString(),
  context: { id: 'ctx', manifest: { id: 'ctx', project_root: '/tmp/demo', sha256: 'abc', files: [], excluded: [], text_truncated: false } },
}

describe('InteractiveTerminal PTY', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalMock.onData = undefined; terminalMock.onResize = undefined; terminalMock.selection = ''
    vi.stubGlobal('EventSource', FakeEventSource)
    Object.defineProperty(window, 'wharnessDesktop', { configurable: true, value: { clipboard } })
    clipboard.readText.mockResolvedValue('printf "copiado"\n')
    clipboard.writeText.mockResolvedValue({ ok: true })
    vi.mocked(api.openTerminal).mockResolvedValue({ terminal_id: 'pty-1', target: 'sandbox' })
    vi.mocked(api.terminalInput).mockResolvedValue(undefined)
    vi.mocked(api.resizeTerminal).mockResolvedValue(undefined)
    vi.mocked(api.closeTerminal).mockResolvedValue(undefined)
    vi.mocked(api.resetTerminal).mockResolvedValue({ status: 'ok' })
  })

  it('opens an isolated PTY and sends keyboard data directly to its shell', async () => {
    render(<InteractiveTerminal session={session} height={245} onHeight={() => undefined} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalledWith('ses-terminal', expect.objectContaining({ cwd: '.', network: false, cols: 80, rows: 24 }), 'sandbox', false))
    terminalMock.onData?.('nano README.md\r')
    await waitFor(() => expect(api.terminalInput).toHaveBeenCalledWith('ses-terminal', 'pty-1', 'nano README.md\r'))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByLabelText('Terminal interactivo')).toBeTruthy()
  })

  it('requires confirmation before opening the full-access Host PTY', async () => {
    vi.mocked(api.openTerminal).mockResolvedValueOnce({ terminal_id: 'pty-sandbox', target: 'sandbox' }).mockResolvedValueOnce({ terminal_id: 'pty-host', target: 'host' })
    render(<InteractiveTerminal session={session} height={245} onHeight={() => undefined} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Host' }))
    expect(api.openTerminal).toHaveBeenCalledTimes(1)
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir shell no HOST' }))
    await waitFor(() => expect(api.openTerminal).toHaveBeenLastCalledWith('ses-terminal', expect.objectContaining({ network: false }), 'host', true))
    expect(screen.getByText('HOST DIRECTO')).toBeTruthy()
    expect(screen.getByText(/Sessão real do utilizador do sistema/)).toBeTruthy()
    terminalMock.onData?.('vim src/App.tsx\r')
    await waitFor(() => expect(api.terminalInput).toHaveBeenCalledWith('ses-terminal', 'pty-host', 'vim src/App.tsx\r'))
  })

  it('copies selections and pastes clipboard text through desktop shortcuts', async () => {
    render(<InteractiveTerminal session={session} height={245} onHeight={() => undefined} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalled())
    const root = screen.getByLabelText('Terminal interactivo')
    terminalMock.selection = './bin/promote republish prod'
    fireEvent.keyDown(root, { key: 'C', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('./bin/promote republish prod'))
    fireEvent.keyDown(root, { key: 'V', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(terminalMock.paste).toHaveBeenCalledWith('printf "copiado"\n'))
  })

  it('forwards terminal dimensions to the live PTY', async () => {
    render(<InteractiveTerminal session={session} height={245} onHeight={() => undefined} onError={() => undefined} />)
    await waitFor(() => expect(api.openTerminal).toHaveBeenCalled())
    terminalMock.onResize?.({ cols: 132, rows: 41 })
    await waitFor(() => expect(api.resizeTerminal).toHaveBeenCalledWith('ses-terminal', 'pty-1', 132, 41))
  })
})

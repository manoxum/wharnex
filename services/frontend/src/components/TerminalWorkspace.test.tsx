import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { TerminalWorkspace } from './TerminalWorkspace'
import { loadTerminalWorkspace, saveTerminalWorkspace } from './terminalWorkspaceState'

vi.mock('./InteractiveTerminal', () => ({
  InteractiveTerminal: ({ visible, reconnectNonce, session: terminalSession, runRequest, onTerminalIDChange }: { visible?: boolean; reconnectNonce?: number; session: Session; runRequest?: { command: string }; onTerminalIDChange?: (id: string) => void }) => <div data-testid="terminal-instance" data-visible={visible ? 'yes' : 'no'} data-reconnect={reconnectNonce} data-session={terminalSession.id} data-command={runRequest?.command}><button onClick={() => onTerminalIDChange?.('')}>Expire</button></div>,
}))

const session = { id: 'ses_multi', project_path: '/tmp/project' } as Session

describe('TerminalWorkspace', () => {
  // Tabs persist per project in localStorage so shells survive app reloads.
  // Every test uses the same project, so each must start from an empty
  // workspace or it inherits the tabs an earlier test opened.
  beforeEach(() => localStorage.clear())

  it('keeps sibling instances mounted while tabs are switched or hidden', () => {
    const { rerender } = render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    fireEvent.click(screen.getByLabelText('Nova instância de terminal'))
    expect(screen.getAllByTestId('terminal-instance')).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /Terminal 2/ }).getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByRole('tab', { name: /Terminal 1/ }))
    expect(screen.getAllByTestId('terminal-instance')).toHaveLength(2)

    rerender(<TerminalWorkspace session={session} height={300} visible={false} onHeight={() => undefined} onError={() => undefined} />)
    expect(screen.getAllByTestId('terminal-instance')).toHaveLength(2)
  })

  it('clears a single expired shell and starts a fresh tab without its old history', () => {
    saveTerminalWorkspace(session.project_path, { activeID: 1, nextID: 2, tabs: [{ id: 1, label: 'Terminal 1', terminalID: 'pty_old', cwd: '.', history: 'old shell', viewportY: 2 }] })
    render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    fireEvent.click(screen.getByText('Expire'))
    expect(screen.getByTestId('terminal-instance').getAttribute('data-reconnect')).toBe('1')
    expect(loadTerminalWorkspace(session.project_path).tabs[0]).toMatchObject({ terminalID: '', history: '', viewportY: 0 })
  })

  it('closes only the requested tab and always leaves a terminal available', () => {
    render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    fireEvent.click(screen.getByLabelText('Nova instância de terminal'))
    fireEvent.click(screen.getByLabelText('Fechar Terminal 2'))
    expect(screen.getAllByTestId('terminal-instance')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /Terminal 1/ })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Fechar Terminal 1'))
    expect(screen.getAllByTestId('terminal-instance')).toHaveLength(1)
  })

  it('renames a terminal tab by double click without a dedicated edit icon', () => {
    render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    const terminal = screen.getByTestId('terminal-instance')
    const tab = screen.getByRole('tab', { name: /Terminal 1/ })
    expect(screen.queryByRole('button', { name: 'Renomear Terminal 1' })).toBeNull()

    fireEvent.doubleClick(tab)
    const input = screen.getByLabelText('Renomear Terminal 1')
    fireEvent.change(input, { target: { value: 'Servidor API' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByRole('tab', { name: /Servidor API/ })).toBeTruthy()
    expect(screen.getByTestId('terminal-instance')).toBe(terminal)
  })

  it('reattaches live terminals when the same project receives a new session id', () => {
    const { rerender } = render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    const terminal = screen.getByTestId('terminal-instance')
    rerender(<TerminalWorkspace session={{ ...session, id: 'ses_refreshed' }} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    expect(screen.getByTestId('terminal-instance')).toBe(terminal)
    expect(terminal.getAttribute('data-session')).toBe('ses_refreshed')
    expect(terminal.getAttribute('data-reconnect')).toBe('1')
  })

  it('creates a new host-only terminal for an Editor execution', () => {
    render(<TerminalWorkspace session={session} height={300} visible={true} runRequest={{ id: 7, command: 'npm test', cwd: 'services/frontend', label: 'npm test', target: 'host', openNew: true }} onHeight={() => undefined} onError={() => undefined} />)
    expect(screen.getAllByTestId('terminal-instance')).toHaveLength(2)
    const host = screen.getAllByTestId('terminal-instance')[1]
    expect(host.getAttribute('data-command')).toBe("cd 'services/frontend' && npm test")
    expect(screen.getByRole('tab', { name: /npm test/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps terminal identity, status and controls on one top line', () => {
    const { container } = render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    const tabbar = container.querySelector('.terminal-tabbar')
    const terminalTab = screen.getByRole('tab', { name: /Terminal 1/ })
    expect(tabbar?.contains(terminalTab)).toBe(true)
    expect(terminalTab.querySelector('svg')).toBeNull()
    expect(terminalTab.getAttribute('title')).toContain('Terminal 1')
    expect(screen.queryByRole('button', { name: 'Renomear Terminal 1' })).toBeNull()
    expect(tabbar?.contains(screen.getByLabelText('Fechar Terminal 1'))).toBe(true)
    expect(tabbar?.contains(screen.getByLabelText('Mais ações do terminal'))).toBe(true)
    expect(screen.queryByRole('menu', { name: 'Ações adicionais do terminal' })).toBeNull()

    fireEvent.click(screen.getByLabelText('Mais ações do terminal'))
    expect(screen.getByRole('menu', { name: 'Ações adicionais do terminal' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /Reconectar/ }))
    expect(screen.getByTestId('terminal-instance').getAttribute('data-reconnect')).toBe('1')
  })

  it('exposes vertical, horizontal and detached terminal surfaces', () => {
    const onSplitTerminal = vi.fn()
    const onDetachTerminal = vi.fn()
    render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} onSplitTerminal={onSplitTerminal} onDetachTerminal={onDetachTerminal} />)

    fireEvent.click(screen.getByLabelText('Dividir terminal verticalmente'))
    fireEvent.click(screen.getByLabelText('Dividir terminal horizontalmente'))
    fireEvent.click(screen.getByLabelText('Mais ações do terminal'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Abrir em janela/ }))

    expect(onSplitTerminal.mock.calls).toEqual([['vertical'], ['horizontal']])
    expect(onDetachTerminal.mock.calls).toHaveLength(1)
  })
})

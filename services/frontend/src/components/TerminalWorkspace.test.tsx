import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { TerminalWorkspace } from './TerminalWorkspace'

vi.mock('./InteractiveTerminal', () => ({
  InteractiveTerminal: ({ visible, reconnectNonce, session: terminalSession, runRequest }: { visible?: boolean; reconnectNonce?: number; session: Session; runRequest?: { command: string } }) => <div data-testid="terminal-instance" data-visible={visible ? 'yes' : 'no'} data-reconnect={reconnectNonce} data-session={terminalSession.id} data-command={runRequest?.command} />,
}))

const session = { id: 'ses_multi', project_path: '/tmp/project' } as Session

describe('TerminalWorkspace', () => {
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

  it('closes only the requested tab and always leaves a terminal available', () => {
    render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    fireEvent.click(screen.getByLabelText('Nova instância de terminal'))
    fireEvent.click(screen.getByLabelText('Fechar Terminal 2'))
    expect(screen.getAllByTestId('terminal-instance')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: /Terminal 1/ })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Fechar Terminal 1'))
    expect(screen.getAllByTestId('terminal-instance')).toHaveLength(1)
  })

  it('renames a terminal tab without replacing its mounted PTY', () => {
    render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    const terminal = screen.getByTestId('terminal-instance')
    fireEvent.click(screen.getByLabelText('Renomear Terminal 1'))
    const input = screen.getByLabelText('Renomear Terminal 1')
    fireEvent.change(input, { target: { value: 'Servidor API' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.getByRole('tab', { name: /Servidor API/ })).toBeTruthy()
    expect(screen.getByTestId('terminal-instance')).toBe(terminal)
  })

  it('keeps live terminals mounted when the same project receives a new session id', () => {
    const { rerender } = render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    const terminal = screen.getByTestId('terminal-instance')
    rerender(<TerminalWorkspace session={{ ...session, id: 'ses_refreshed' }} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} />)
    expect(screen.getByTestId('terminal-instance')).toBe(terminal)
    expect(terminal.getAttribute('data-session')).toBe('ses_multi')
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
    expect(tabbar?.contains(screen.getByRole('tab', { name: /Terminal 1/ }))).toBe(true)
    expect(tabbar?.contains(screen.getByLabelText('Fechar Terminal 1'))).toBe(true)
    expect(tabbar?.contains(screen.getByLabelText('Reconectar terminal'))).toBe(true)
    expect(tabbar?.contains(screen.getByLabelText('Aumentar/reduzir terminal'))).toBe(true)

    fireEvent.click(screen.getByLabelText('Reconectar terminal'))
    expect(screen.getByTestId('terminal-instance').getAttribute('data-reconnect')).toBe('1')
  })

  it('exposes vertical, horizontal and detached terminal surfaces', () => {
    const onSplitTerminal = vi.fn()
    const onDetachTerminal = vi.fn()
    render(<TerminalWorkspace session={session} height={300} visible={true} onHeight={() => undefined} onError={() => undefined} onSplitTerminal={onSplitTerminal} onDetachTerminal={onDetachTerminal} />)

    fireEvent.click(screen.getByLabelText('Dividir terminal verticalmente'))
    fireEvent.click(screen.getByLabelText('Dividir terminal horizontalmente'))
    fireEvent.click(screen.getByLabelText('Abrir terminal numa janela independente'))

    expect(onSplitTerminal.mock.calls).toEqual([['vertical'], ['horizontal']])
    expect(onDetachTerminal.mock.calls).toHaveLength(1)
  })
})

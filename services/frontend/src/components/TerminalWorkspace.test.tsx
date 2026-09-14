import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { TerminalWorkspace } from './TerminalWorkspace'

vi.mock('./InteractiveTerminal', () => ({
  InteractiveTerminal: ({ visible }: { visible?: boolean }) => <div data-testid="terminal-instance" data-visible={visible ? 'yes' : 'no'} />,
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
})

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceNavigation } from './WorkspaceNavigation'

describe('grouped workbench navigation', () => {
  it('keeps customized order, groups consecutive tools, and identifies selection', () => {
    const onToggle = vi.fn()
    const { container } = render(<WorkspaceNavigation side="left" tools={['project', 'git', 'external-agents', 'tasks', 'database']} pinnedTools={['terminal']} drawer="tasks" terminalOpen={false} pendingCommitCount={2} savedChatCount={0} onToggle={onToggle} onToggleTerminal={vi.fn()}/>)
    expect(Array.from(container.querySelectorAll('[data-workspace-tool]')).map((node) => node.getAttribute('data-workspace-tool'))).toEqual(['project', 'git', 'external-agents', 'tasks', 'database', 'terminal'])
    expect(within(screen.getByRole('group', { name: 'Desenvolvimento' })).getByRole('button', { name: 'Git do projeto' })).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Inteligência artificial' })).getByRole('button', { name: 'Codex' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tarefas do projeto' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Git do projeto' }))
    expect(onToggle).toHaveBeenCalledWith('git')
  })

  it('retains explicit terminal control and drag placement including pinning', () => {
    const move = vi.fn(), terminal = vi.fn()
    render(<WorkspaceNavigation side="right" tools={['database']} pinnedTools={['terminal']} drawer="" terminalOpen pendingCommitCount={0} savedChatCount={0} onToggle={vi.fn()} onToggleTerminal={terminal} onMoveTool={move}/>)
    const transfer = { getData: () => 'git', setData: vi.fn() }
    fireEvent.drop(screen.getByRole('button', { name: 'Database connection' }), { dataTransfer: transfer })
    expect(move).toHaveBeenCalledWith('git', 'right', 'database', false)
    fireEvent.drop(screen.getByLabelText('Ferramentas fixadas no canto inferior'), { dataTransfer: transfer })
    expect(move).toHaveBeenCalledWith('git', 'right', undefined, true)
    fireEvent.click(screen.getByRole('button', { name: 'Fechar terminal' }))
    expect(terminal).toHaveBeenCalledTimes(1)
  })
})

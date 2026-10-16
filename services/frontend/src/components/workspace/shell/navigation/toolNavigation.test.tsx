import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { WorkspaceNavigation } from './WorkspaceNavigation'
it('navigates the stripe with arrows and Home/End without opening another tool', () => {
  const onToggle = vi.fn()
  render(<WorkspaceNavigation side="left" tools={['project', 'git', 'docker']} pinnedTools={['terminal']} drawer="git" terminalOpen={false} pendingCommitCount={0} savedChatCount={0} onToggle={onToggle} onToggleTerminal={vi.fn()}/>)
  const first = screen.getByRole('button', { name: 'Explorador do projeto' })
  first.focus(); fireEvent.keyDown(first, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Git do projeto' }))
  fireEvent.keyDown(document.activeElement!, { key: 'End' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir terminal' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Home' })
  expect(document.activeElement).toBe(first)
  expect(onToggle).not.toHaveBeenCalled()
})

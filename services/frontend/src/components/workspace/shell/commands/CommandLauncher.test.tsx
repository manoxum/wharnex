import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandLauncher } from './CommandLauncher'

describe('command launcher', () => {
  it('shows only the search icon while retaining its accessible name and shortcut', () => {
    render(<CommandLauncher onOpen={vi.fn()}/> )
    const button = screen.getByRole('button', { name: 'Pesquisar e executar comandos' })
    expect(button.title).toContain('Ctrl/⌘ + Shift + P')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.textContent).toBe('')
  })

  it('opens the command palette through the supplied action or the shared event', () => {
    const onOpen = vi.fn()
    render(<CommandLauncher onOpen={onOpen}/>)
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar e executar comandos' }))
    expect(onOpen).toHaveBeenCalledOnce()

    const dispatched = vi.fn()
    window.addEventListener('wharnex:open-commands', dispatched)
    render(<CommandLauncher/>)
    fireEvent.click(screen.getAllByRole('button', { name: 'Pesquisar e executar comandos' })[1])
    expect(dispatched).toHaveBeenCalledOnce()
    window.removeEventListener('wharnex:open-commands', dispatched)
  })
})

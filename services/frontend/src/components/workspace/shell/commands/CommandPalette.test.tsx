import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'

describe('workbench command palette', () => {
  it('filters real actions, supports keyboard selection and runs only the chosen command', () => {
    const files = vi.fn(), terminal = vi.fn(), close = vi.fn()
    render(<CommandPalette onClose={close} commands={[{ id: 'files', label: 'Localizar ficheiro', description: 'Explorar o projeto', icon: 'file', run: files }, { id: 'terminal', label: 'Alternar terminal', description: 'Sessões do projeto', icon: 'terminal', run: terminal }]}/>)
    const input = screen.getByRole('combobox', { name: 'Pesquisar comandos' })
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: 'terminal' } })
    expect(screen.queryByRole('option', { name: /Localizar ficheiro/ })).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(terminal).toHaveBeenCalledTimes(1)
    expect(files).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('provides a truthful empty state and Escape does not run a command', () => {
    const run = vi.fn(), close = vi.fn()
    render(<CommandPalette onClose={close} commands={[{ id: 'git', label: 'Git', description: 'Rever alterações', icon: 'git', run }]}/>)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'inexistente' } })
    expect(screen.getByText('Nenhum comando encontrado')).toBeTruthy()
    expect(input.getAttribute('aria-activedescendant')).toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
  })
  it('keeps Tab inside its modal without treating arrow-navigated options as tab stops', () => {
    render(<CommandPalette onClose={vi.fn()} commands={[{ id: 'git', label: 'Git', description: 'Rever alterações', icon: 'git', run: vi.fn() }]}/>)
    const input = screen.getByRole('combobox')
    const close = screen.getByRole('button', { name: 'Fechar comandos' })
    close.focus()
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
    expect(screen.getByRole('option').tabIndex).toBe(-1)
  })
})

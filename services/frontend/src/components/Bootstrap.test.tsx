import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bootstrap } from './Bootstrap'

describe('Bootstrap project home', () => {
  beforeEach(() => { localStorage.clear(); delete window.wharnessDesktop })

  it('starts a new project from a large briefing without the legacy hero panel', async () => {
    const onBootstrap = vi.fn().mockResolvedValue(undefined)
    render(<Bootstrap busy={false} recent={['/workspace/existing']} restoring={false} onStart={vi.fn()} onCreate={vi.fn()} onClone={vi.fn()} onBootstrap={onBootstrap} />)

    expect(screen.queryByText(/Abra, crie ou clone/i)).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: 'Descrever novo projeto' }), { target: { value: 'Criar um gestor de tarefas offline moderno' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar projeto a partir deste prompt' }))

    await waitFor(() => expect(onBootstrap).toHaveBeenCalledTimes(1))
    expect(onBootstrap.mock.calls[0][0]).toBe('/workspace')
    expect(onBootstrap.mock.calls[0][1]).toBe('criar-gestor-tarefas-offline')
    expect(onBootstrap.mock.calls[0][2]).toContain('Briefing inicial:')
    expect(onBootstrap.mock.calls[0][2]).toContain('Criar um gestor de tarefas offline moderno')
  })

  it('keeps open, create and clone as compact project actions', () => {
    render(<Bootstrap busy={false} recent={[]} restoring={false} onStart={vi.fn()} onCreate={vi.fn()} onClone={vi.fn()} onBootstrap={vi.fn()} />)
    const actions = within(screen.getByRole('region', { name: 'Ações de projeto' }))
    expect(actions.getByRole('button', { name: /Abrir pasta/i })).toBeTruthy()
    expect(actions.getByRole('button', { name: /Criar projeto/i })).toBeTruthy()
    expect(actions.getByRole('button', { name: /Clonar Git/i })).toBeTruthy()
  })
})

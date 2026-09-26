import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Bootstrap } from './Bootstrap'
import { findComposerEditor } from '../lib/composerRichText'

describe('Bootstrap project home', () => {
  beforeEach(() => { localStorage.clear(); delete window.wharnessDesktop })

  it('starts a new project from a large briefing without the legacy hero panel', async () => {
    const onBootstrap = vi.fn().mockResolvedValue(undefined)
    const view = render(<Bootstrap busy={false} recent={['/workspace/existing']} restoring={false} onStart={vi.fn()} onCreate={vi.fn()} onClone={vi.fn()} onBootstrap={onBootstrap} />)

    expect(screen.queryByText(/Abra, crie ou clone/i)).toBeNull()
    const editor = findComposerEditor(view.container)
    if (!editor) throw new Error('bootstrap composer editor not mounted')
    await waitFor(() => expect(editor.root.getAttribute('aria-label')).toBe('Descrever novo projeto'))
    act(() => { editor.setText('Criar um gestor de tarefas offline moderno', 'user') })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Criar projeto com Chat' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Criar projeto com Chat' }))

    await waitFor(() => expect(onBootstrap).toHaveBeenCalledTimes(1))
    expect(onBootstrap.mock.calls[0][0]).toBe('/workspace')
    expect(onBootstrap.mock.calls[0][1]).toBe('criar-gestor-tarefas-offline')
    expect(onBootstrap.mock.calls[0][2]).toContain('Briefing inicial:')
    expect(onBootstrap.mock.calls[0][2]).toContain('Criar um gestor de tarefas offline moderno')
    expect(onBootstrap.mock.calls[0][3]).toMatchObject({ entryMode: 'agent', automationMode: 'auto', effortLevel: 'high', reasoningEffort: 'high', chatTransportMode: 'scraper', requestMode: 'direct' })
  })

  it('can start the prompt directly in Orchestrator planning mode', async () => {
    const onBootstrap = vi.fn().mockResolvedValue(undefined)
    const view = render(<Bootstrap busy={false} recent={['/workspace/existing']} restoring={false} onStart={vi.fn()} onCreate={vi.fn()} onClone={vi.fn()} onBootstrap={onBootstrap} />)

    fireEvent.click(screen.getByRole('button', { name: 'Orchestrator' }))
    expect(screen.getByRole('button', { name: 'Orchestrator' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Planificar antes de alterar' })).toBeNull()

    const editor = findComposerEditor(view.container)
    if (!editor) throw new Error('bootstrap composer editor not mounted')
    act(() => { editor.setText('Criar uma plataforma de reservas com API e painel', 'user') })
    fireEvent.click(screen.getByRole('button', { name: 'Criar projeto com Orchestrator' }))

    await waitFor(() => expect(onBootstrap).toHaveBeenCalledTimes(1))
    expect(onBootstrap.mock.calls[0][2]).toBe('Criar uma plataforma de reservas com API e painel')
    expect(onBootstrap.mock.calls[0][3]).toMatchObject({ entryMode: 'orchestrator' })
  })

  it('keeps the new-project identity centered and the entry modes compact', () => {
    const view = render(<Bootstrap busy={false} recent={['/workspace/existing']} restoring={false} onStart={vi.fn()} onCreate={vi.fn()} onClone={vi.fn()} onBootstrap={vi.fn()} />)
    const composer = view.container.querySelector<HTMLElement>('.bootstrap-composer')
    if (!composer) throw new Error('bootstrap composer not mounted')

    expect(within(composer).queryByText('Workspace')).toBeNull()
    expect(within(composer).getByRole('textbox', { name: 'Nome do novo projeto' })).toBeTruthy()
    expect(within(composer).getByRole('button', { name: 'Chat' })).toBeTruthy()
    expect(within(composer).getByRole('button', { name: 'Orchestrator' })).toBeTruthy()
    expect(composer.querySelector('.bootstrap-composer-topline')).toBeTruthy()
    expect(composer.querySelector('.bootstrap-entry-modes')).toBeTruthy()
  })

  it('reuses project composer controls and removes the old informational cards', () => {
    render(<Bootstrap busy={false} recent={[]} restoring={false} onStart={vi.fn()} onCreate={vi.fn()} onClone={vi.fn()} onBootstrap={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Manual' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Auto' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Auto + Aprovar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Scraper' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Manual (transporte)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Planificar antes de alterar' })).toBeTruthy()
    expect(screen.queryByText('Git desde o início')).toBeNull()
    expect(screen.queryByText('Execução protegida')).toBeNull()
  })

  it('keeps open, create and clone as compact project actions', () => {
    render(<Bootstrap busy={false} recent={[]} restoring={false} onStart={vi.fn()} onCreate={vi.fn()} onClone={vi.fn()} onBootstrap={vi.fn()} />)
    const actions = within(screen.getByRole('region', { name: 'Ações de projeto' }))
    expect(actions.getByRole('button', { name: /Abrir pasta/i })).toBeTruthy()
    expect(actions.getByRole('button', { name: /Criar projeto/i })).toBeTruthy()
    expect(actions.getByRole('button', { name: /Clonar Git/i })).toBeTruthy()
  })

  it('opens the desktop folder picker directly from the quick action and starts in the configured workspace', async () => {
    localStorage.setItem('kernl.workspace.directory.v1', '/workspace')
    const pickDirectory = vi.fn().mockResolvedValue({ cancelled: false, path: '/workspace/demo' })
    window.wharnessDesktop = { projects: { pickDirectory } } as never
    const onStart = vi.fn().mockResolvedValue(undefined)
    render(<Bootstrap busy={false} recent={[]} restoring={false} onStart={onStart} onCreate={vi.fn()} onClone={vi.fn()} onBootstrap={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Abrir pasta/i }))

    await waitFor(() => expect(pickDirectory).toHaveBeenCalledWith({ title: 'Selecionar projeto', defaultPath: '/workspace' }))
    await waitFor(() => expect(onStart).toHaveBeenCalledWith('/workspace/demo'))
    expect(screen.queryByText('Escolher pasta do projeto')).toBeNull()
  })

  it('exposes global settings and no longer shows the AI icon in the new-project composer heading', () => {
    render(<Bootstrap busy={false} recent={[]} restoring={false} onStart={vi.fn()} onCreate={vi.fn()} onClone={vi.fn()} onBootstrap={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Configurações globais' })).toBeTruthy()
    expect(screen.getByText('O que quer construir?')).toBeTruthy()
    expect(screen.queryByText('Escolher pasta do projeto')).toBeNull()
  })

})

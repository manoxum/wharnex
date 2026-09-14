import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { loadBoundProjects, saveBoundActiveProject, saveBoundProjects } from '../lib/projectBindings'
import { rememberRecent } from '../lib/workspaceMemory'
import { ShellChrome, WorkspaceShell } from './WorkspaceShell'

describe('WorkspaceShell project actions', () => {
  beforeEach(() => { localStorage.clear(); delete window.wharnessDesktop })
  afterEach(() => { vi.restoreAllMocks(); delete window.wharnessDesktop })

  it('closes the project actions menu with Escape or a click outside it', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false })
    render(<WorkspaceShell />)

    const trigger = await screen.findByRole('button', { name: 'Ações de projeto' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('uses Signal Core alone as the primary toolbar brand mark', () => {
    render(<ShellChrome projects={[]} activeProject="" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onBindPath={vi.fn()} onNewWindow={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'Signal Core' })).toBeTruthy()
    expect(screen.queryByText('WHX')).toBeNull()
    expect(screen.queryByText('Wharnex')).toBeNull()
  })

  it('binds an additional project from its complete local path', () => {
    const onBindPath = vi.fn()
    render(<ShellChrome projects={['/work/current']} activeProject="/work/current" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onBindPath={onBindPath} onNewWindow={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ações de projeto' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Caminho completo do projeto' }), { target: { value: '/work/related' } })
    fireEvent.click(screen.getByRole('menuitem', { name: /Vincular por caminho/i }))
    expect(onBindPath).toHaveBeenCalledWith('/work/related')
  })

  it('places the instance identifier before the Editor and Agent selector', () => {
    render(<ShellChrome instanceID="legacy" version="v1.2.46.13" projects={['/tmp/legacy']} activeProject="/tmp/legacy" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onBindPath={vi.fn()} onNewWindow={vi.fn()} />)
    const badge = screen.getByLabelText('Instância: legacy · versão v1.2.46.13')
    expect(badge.textContent).toBe('legacy · v1.2.46.13')
    const editor = screen.getByRole('button', { name: 'Editor' })
    expect(Boolean(badge.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })


  it('shows recent projects before opening the native folder chooser', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({ planner: 'openai', sandbox: 'docker', model: 'test', api_configured: true, chatgpt_web_embed: false })
    rememberRecent('/tmp/recent-project')
    const pickDirectory = vi.fn().mockResolvedValue({ cancelled: true })
    window.wharnessDesktop = {
      projects: { pickDirectory },
      windows: { open: vi.fn() },
    } as unknown as WharnessDesktopBridge

    render(<WorkspaceShell />)
    const trigger = await screen.findByRole('button', { name: 'Ações de projeto' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /Vincular projeto/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Vincular projeto' })
    const modal = within(dialog)
    expect(modal.getByText('recent-project')).toBeTruthy()
    expect(modal.getByRole('button', { name: /Criar projeto/ })).toBeTruthy()
    expect(modal.getByRole('button', { name: /Clonar Git/ })).toBeTruthy()
    expect(pickDirectory).not.toHaveBeenCalled()

    fireEvent.click(modal.getByRole('button', { name: /Carregar outro/ }))
    await waitFor(() => expect(pickDirectory).toHaveBeenCalledWith({ title: 'Vincular projeto' }))
  })

  it('gives every linked project a stable accent and focuses projects owned by another window', async () => {
    const focusProject = vi.fn().mockResolvedValue({ ok: true, windowId: 'window-b', projectPath: '/tmp/beta' })
    window.wharnessDesktop = {
      windows: {
        projects: vi.fn().mockResolvedValue({ currentWindowId: 'window-a', items: [{ windowId: 'window-b', projectPath: '/tmp/beta', focused: false }] }),
        focusProject,
      },
    } as unknown as WharnessDesktopBridge
    const onActivate = vi.fn()

    render(<ShellChrome projects={['/tmp/alpha', '/tmp/gamma']} activeProject="/tmp/alpha" mode="agent" busy={false} onActivate={onActivate} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    const alpha = screen.getByRole('button', { name: /alpha/ })
    const gamma = screen.getByRole('button', { name: /gamma/ })
    expect(alpha.style.getPropertyValue('--project-hue')).not.toBe('')
    expect(gamma.style.getPropertyValue('--project-hue')).not.toBe('')
    expect(alpha.style.getPropertyValue('--project-hue')).not.toBe(gamma.style.getPropertyValue('--project-hue'))

    fireEvent.click(alpha)
    expect(await screen.findByText('Outras janelas')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /beta.*Trazer janela para a frente/i }))
    await waitFor(() => expect(focusProject).toHaveBeenCalledWith('/tmp/beta'))
    expect(onActivate).not.toHaveBeenCalledWith('/tmp/beta')
  })

  it('answers a loaded project readiness handshake with its current activation state', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: false, chatgpt_web_embed: true })
    saveBoundProjects(['/tmp/active-project'])
    saveBoundActiveProject('/tmp/active-project')
    window.wharnessDesktop = {
      projects: { acquire: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/active-project' }) },
    } as unknown as WharnessDesktopBridge
    expect(loadBoundProjects()).toEqual(['/tmp/active-project'])

    render(<WorkspaceShell />)
    const frame = await screen.findByTitle('Wharnex · active-project') as HTMLIFrameElement
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: frame.contentWindow,
      data: { type: 'wharness:project-ready', projectPath: '/tmp/active-project' },
    }))

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { type: 'wharness:project-active', active: true, projects: ['/tmp/active-project'] },
      window.location.origin,
    ))
  })

  it('shows when bound projects share analysis context', () => {
    render(<ShellChrome projects={['/work/current', '/work/related']} activeProject="/work/current" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onBindPath={vi.fn()} onNewWindow={vi.fn()} />)
    expect(screen.getByText('2 projetos no contexto')).toBeTruthy()
  })
})

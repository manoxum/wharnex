import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../lib/api'
import { loadBoundProjects, saveBoundActiveProject, saveBoundProjects } from '../lib/projectBindings'
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
    render(<ShellChrome projects={[]} activeProject="" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'Signal Core' })).toBeTruthy()
    expect(screen.queryByText('WHX')).toBeNull()
    expect(screen.queryByText('Wharnex')).toBeNull()
  })

  it('places the instance identifier before the Editor and Agent selector', () => {
    render(<ShellChrome instanceID="legacy" version="v1.2.46.13" projects={['/tmp/legacy']} activeProject="/tmp/legacy" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    const badge = screen.getByLabelText('Instância: legacy · versão v1.2.46.13')
    expect(badge.textContent).toBe('legacy · v1.2.46.13')
    const editor = screen.getByRole('button', { name: 'Editor' })
    expect(Boolean(badge.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
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
      { type: 'wharness:project-active', active: true },
      window.location.origin,
    ))
  })
})

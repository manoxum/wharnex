import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { loadBoundProjects, saveBoundActiveProject, saveBoundProjects } from '../../../lib/project/context/projectBindings'
import { rememberRecent } from '../../../lib/chat/history/workspaceMemory'
import { setLocalePreference } from '../../../lib/workspace/localization'
import { ShellChrome, WorkspaceShell } from './WorkspaceShell'
describe('WorkspaceShell project actions', () => {
beforeEach(() => { localStorage.clear(); setLocalePreference('pt'); delete window.wharnessDesktop })
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

it('leads the title bar with Signal Core while keeping the active project first in the switcher', () => {
    const { container } = render(<ShellChrome projects={['/tmp/alpha', '/tmp/gamma']} activeProject="/tmp/gamma" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    const bar = container.querySelector('.multi-project-bar')
    const brand = container.querySelector('.multi-project-brand')
    const switcher = screen.getByRole('tablist', { name: 'Projetos vinculados' })
    expect(bar?.firstElementChild).toBe(brand)
    expect(brand?.nextElementSibling).toBe(switcher)
    expect(switcher?.firstElementChild?.textContent).toContain('gamma')
    expect(switcher?.firstElementChild?.querySelector('[role="tab"]')?.getAttribute('aria-selected') === 'true').toBe(true)
  })

it('keeps project unlink on the project tab instead of the global action cluster', () => {
    const onUnbind = vi.fn()
    const { container } = render(<ShellChrome projects={['/tmp/alpha', '/tmp/gamma']} activeProject="/tmp/alpha" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={onUnbind} onBind={vi.fn()} onNewWindow={vi.fn()} />)

    const activeTab = container.querySelector('[role="tab"][aria-selected="true"]')?.parentElement
    const unlink = within(activeTab as HTMLElement).getByRole('button', { name: 'Desvincular alpha desta janela' })
    fireEvent.click(unlink)

    expect(onUnbind).toHaveBeenCalledWith('/tmp/alpha')
    expect(container.querySelector('.multi-project-actions [aria-label="Desvincular projeto"]')).toBeNull()
  })

it('marks the shell chrome as the desktop window title bar', () => {
    const { container } = render(<ShellChrome projects={[]} activeProject="" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    expect(container.querySelector('.multi-project-bar')?.getAttribute('data-window-titlebar')).toBe('true')
  })

it('routes themed window chrome controls through the desktop bridge', () => {
    const minimize = vi.fn().mockResolvedValue({ ok: true })
    const toggleMaximize = vi.fn().mockResolvedValue({ ok: true, maximized: true })
    const close = vi.fn().mockResolvedValue({ ok: true })
    window.wharnessDesktop = { windows: { minimize, toggleMaximize, close } } as unknown as WharnessDesktopBridge

    render(<ShellChrome projects={[]} activeProject="" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Minimizar janela' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximizar ou restaurar janela' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fechar janela' }))

    expect(minimize).toHaveBeenCalledTimes(1)
    expect(toggleMaximize).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

it('keeps themed title-bar window controls in the Desktop shell', () => {
    window.wharnessDesktop = { platform: 'linux', windows: {} } as unknown as WharnessDesktopBridge

    render(<ShellChrome projects={[]} activeProject="" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Controlos da janela' })).toBeTruthy()
  })

it('places the active WHX runtime badge inside the unified window controls', () => {
    render(<ShellChrome projects={['/tmp/self']} activeProject="/tmp/self" activeRuntime={{ selfEvolution: true, instanceId: '' }} mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)

    const controls = screen.getByRole('group', { name: 'Controlos da janela' })
    const badge = screen.getByText('WHX · AUTO-EVOLUÇÃO')
    expect(badge.parentElement).toBe(controls)
    expect(controls.firstElementChild).toBe(badge)
  })

it('places the active project notification control in the desktop title bar', () => {
    const onAttention = vi.fn()
    const { container } = render(<ShellChrome projects={['/tmp/alpha']} activeProject="/tmp/alpha" activeAttention={{ total: 4, urgent: 1, actionable: 2 }} mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onAttention={onAttention} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    const button = screen.getByRole('button', { name: /Centro de notificações, 4 alerta\(s\), 1 urgente\(s\), 2 com ação/ })
    expect(button.closest('.multi-project-actions')).toBeTruthy()
    expect(button.className).toContain('has-alerts')
    expect(button.getAttribute('data-attention-trigger')).toBe('true')
    expect(button.getAttribute('title')).toBe('Notificações · ver alertas recentes')
    expect(container.querySelector('.workspace-attention-count')?.textContent).toBe('4')
    fireEvent.click(button)
    expect(onAttention).toHaveBeenCalledTimes(1)
  })

it('keeps manual path binding out of the quick project actions menu', () => {
    render(<ShellChrome projects={['/work/current']} activeProject="/work/current" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ações de projeto' }))

    expect(screen.queryByRole('textbox', { name: 'Caminho completo do projeto' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Vincular por caminho/i })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /Vincular/i })).toBeTruthy()
  })

it('places the active branch and project version before the mode selector', async () => {
    vi.spyOn(api, 'gitOverview').mockResolvedValue({
      project_path: '/tmp/legacy', project_version: 'v2.4.1.0', available: true, commit_mode: 'auto', current_branch: 'feature/git-shell', detached: false,
      repository: '', repositories: [],
      has_identity: true, branches: [{ name: 'feature/git-shell', current: true, commit_sha: 'abc123', has_upstream: false, ahead: 0, behind: 0, gone: false }], remotes: [], tags: [], commits: [], pending: [],
      working: { clean: true, stageable_count: 0, files: [] },
    })
    render(<ShellChrome projects={['/tmp/legacy']} activeProject="/tmp/legacy" activeSessionID="ses_git" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    const badge = await screen.findByLabelText('Git: feature/git-shell, projeto v2.4.1.0')
    expect(badge.textContent).toContain('feature/git-shell')
    expect(badge.textContent).toContain('v2.4.1.0')
    expect(screen.queryByText(/legacy · v1\.2\.46\.13/)).toBeNull()
    const editor = screen.getByRole('button', { name: 'Editor' })
    expect(Boolean(badge.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

it('renders shell workspace modes as icon-only controls with accessible names', () => {
    render(<ShellChrome projects={['/tmp/legacy']} activeProject="/tmp/legacy" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    for (const name of ['Editor', 'Agent', 'Orchestrator']) {
      const button = screen.getByRole('button', { name })
      expect(button.textContent).toBe('')
      expect(button.getAttribute('title')).toBe(name)
    }
  })

it('shows recent projects directly in the project action hub before browsing folders', async () => {
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

    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('recent-project')).toBeTruthy()
    expect(within(menu).getByRole('button', { name: 'Abrir recent-project' })).toBeTruthy()
    expect(within(menu).getByRole('button', { name: 'Vincular recent-project' })).toBeTruthy()
    expect(pickDirectory).not.toHaveBeenCalled()

    fireEvent.click(within(menu).getByRole('menuitem', { name: /Vincular/i }))
    await waitFor(() => expect(pickDirectory).toHaveBeenCalledWith({ title: 'Vincular projeto' }))
  })

it('opens a recent project from its name or open icon without hijacking other actions', () => {
    const onOpenProject = vi.fn()
    const onLinkProject = vi.fn()
    const onForgetProject = vi.fn()
    render(<ShellChrome projects={[]} recent={['/tmp/recent-project']} activeProject="" mode="agent" busy={false}
      onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()}
      onOpenProject={onOpenProject} onLinkProject={onLinkProject} onForgetProject={onForgetProject} onNewWindow={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Ações de projeto' })

    fireEvent.click(trigger)
    const projectEntry = within(screen.getByRole('menu')).getByRole('button', { name: 'Abrir projeto recent-project pela lista' })
    expect(projectEntry.tagName).toBe('BUTTON')
    fireEvent.click(projectEntry)
    expect(onOpenProject).toHaveBeenCalledWith('/tmp/recent-project')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Abrir recent-project' }))
    expect(onOpenProject).toHaveBeenCalledTimes(2)
    expect(onOpenProject).toHaveBeenLastCalledWith('/tmp/recent-project')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Vincular recent-project' }))
    expect(onLinkProject).toHaveBeenCalledWith('/tmp/recent-project')
    fireEvent.click(trigger)
    fireEvent.click(within(screen.getByRole('menu')).getByRole('button', { name: 'Remover recent-project dos recentes' }))
    expect(onForgetProject).toHaveBeenCalledWith('/tmp/recent-project')
    expect(onOpenProject).toHaveBeenCalledTimes(2)
  })

it('can unlink any project bound to the current window from the project switcher', async () => {
    const onActivate = vi.fn()
    const onUnbind = vi.fn()
    window.wharnessDesktop = {
      windows: { projects: vi.fn().mockResolvedValue({ currentWindowId: 'window-a', items: [] }) },
    } as unknown as WharnessDesktopBridge

    render(<ShellChrome projects={['/tmp/alpha', '/tmp/gamma']} activeProject="/tmp/alpha" mode="agent" busy={false} onActivate={onActivate} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={onUnbind} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Desvincular gamma desta janela' }))

    expect(onUnbind).toHaveBeenCalledWith('/tmp/gamma')
    expect(onActivate).not.toHaveBeenCalledWith('/tmp/gamma')
    expect(screen.queryByText('Projetos abertos')).toBeNull()
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

it('asks the active embedded project to close its header overlay when another shell control opens', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: false, chatgpt_web_embed: true })
    saveBoundProjects(['/tmp/active-project'])
    saveBoundActiveProject('/tmp/active-project')
    window.wharnessDesktop = { projects: { acquire: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/active-project' }) } } as unknown as WharnessDesktopBridge

    render(<WorkspaceShell />)
    const frame = await screen.findByTitle('Wharnex · active-project') as HTMLIFrameElement
    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage')
    fireEvent.click(screen.getByRole('button', { name: 'Aparência rápida' }))

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { type: 'wharness:close-header-overlays' },
      window.location.origin,
    ))
  })

it('binds the active embedded session to the shell Git badge', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: false, chatgpt_web_embed: true })
    const gitOverview = vi.spyOn(api, 'gitOverview').mockResolvedValue({
      project_path: '/tmp/active-project', project_version: 'v3.1.0.0', available: true, commit_mode: 'auto', current_branch: 'main', detached: false,
      repository: '', repositories: [],
      has_identity: true, branches: [{ name: 'main', current: true, commit_sha: 'abc123', has_upstream: false, ahead: 0, behind: 0, gone: false }], remotes: [], tags: [], commits: [], pending: [],
      working: { clean: true, stageable_count: 0, files: [] },
    })
    saveBoundProjects(['/tmp/active-project'])
    saveBoundActiveProject('/tmp/active-project')
    window.wharnessDesktop = {
      projects: { acquire: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/active-project' }) },
    } as unknown as WharnessDesktopBridge

    render(<WorkspaceShell />)
    const frame = await screen.findByTitle('Wharnex · active-project') as HTMLIFrameElement
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: frame.contentWindow,
      data: { type: 'wharness:project-session', projectPath: '/tmp/active-project', sessionId: 'ses_shell' },
    }))

    await waitFor(() => expect(gitOverview).toHaveBeenCalledWith('ses_shell', ''))
    expect(await screen.findByLabelText('Git: main, projeto v3.1.0.0')).toBeTruthy()
  })

it('accepts runtime identity only from the matching embedded project frame', async () => {
    vi.spyOn(api, 'config').mockResolvedValue({ planner: 'manual', sandbox: 'docker', model: 'test', api_configured: false, chatgpt_web_embed: true })
    saveBoundProjects(['/tmp/active-project'])
    saveBoundActiveProject('/tmp/active-project')
    window.wharnessDesktop = {
      projects: { acquire: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/active-project' }) },
    } as unknown as WharnessDesktopBridge

    render(<WorkspaceShell />)
    const frame = await screen.findByTitle('Wharnex · active-project') as HTMLIFrameElement
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      source: frame.contentWindow,
      data: { type: 'wharness:project-runtime', projectPath: '/tmp/active-project', selfEvolution: true, instanceId: '' },
    }))

    const badge = await screen.findByText('WHX · AUTO-EVOLUÇÃO')
    expect(badge.parentElement?.classList.contains('window-chrome-controls')).toBe(true)
  })

it('shows when bound projects share analysis context', () => {
    render(<ShellChrome projects={['/work/current', '/work/related']} activeProject="/work/current" mode="agent" busy={false} onActivate={vi.fn()} onMode={vi.fn()} onSettings={vi.fn()} onUnbind={vi.fn()} onBind={vi.fn()} onNewWindow={vi.fn()} />)
    expect(screen.getByText('2 projetos no contexto')).toBeTruthy()
  })
})

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { api } from '../lib/api'
import { desktopBridge } from '../lib/desktop'
import { desktopWindowScope, loadBoundActiveProject, loadBoundProjects, saveBoundActiveProject, saveBoundProjects } from '../lib/projectBindings'
import { loadActiveWorkspace, loadRecentWorkspaces, rememberRecent } from '../lib/workspaceMemory'
import type { AppConfig, WorkspaceMode } from '../types'
import { Bootstrap } from './Bootstrap'
import { Icon } from './Icon'
import { ThemeToggle } from './ThemeToggle'
import { ErrorToast } from './ErrorToast'
import { TunnelOverviewModal } from './TunnelOverviewModal'
import { InstanceBadge } from './InstanceBadge'
import { SignalCore } from './SignalCore'
import { ProjectLinkModal } from './ProjectLinkModal'

type ProjectLockResult = { ok: boolean; path: string; ownerWindowId?: string; message?: string }
type OpenProjectWindow = { windowId: string; projectPath: string; focused: boolean }
type ProjectWindowSnapshot = { currentWindowId: string; items: OpenProjectWindow[] }

const MAX_BOUND_PROJECTS = 12
const INSTANCE_ID = import.meta.env.VITE_WHARNESS_INSTANCE_ID?.trim()

export function WorkspaceShell() {
  const [config, setConfig] = useState<AppConfig>()
  const [projects, setProjects] = useState<string[]>([])
  const [activeProject, setActiveProject] = useState('')
  const [projectModes, setProjectModes] = useState<Record<string, WorkspaceMode>>({})
  const [recent, setRecent] = useState<string[]>(loadRecentWorkspaces())
  const [busy, setBusy] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [error, setError] = useState<string>()
  const frames = useRef(new Map<string, HTMLIFrameElement>())

  useEffect(() => {
    let alive = true
    async function initialize() {
      try { if (alive) setConfig(await api.config()) } catch (reason) { if (alive) setError(messageOf(reason)) }
      const bridge = desktopBridge()
      const legacy = desktopWindowScope() === 'primary' ? loadActiveWorkspace()?.projectPath || '' : ''
      const candidates = loadBoundProjects()
      if (!candidates.length && legacy) candidates.push(legacy)
      const acquired: string[] = []
      for (const candidate of candidates) {
        try {
          const lock = await bridge?.projects.acquire(candidate)
          if (!bridge || lock?.ok) acquired.push(lock?.path || candidate)
        } catch { /* stale saved binding is ignored */ }
      }
      if (!alive) return
      const preferred = loadBoundActiveProject()
      const active = acquired.includes(preferred) ? preferred : acquired[0] || ''
      setProjects(acquired); setActiveProject(active); saveBoundProjects(acquired); saveBoundActiveProject(active); setBusy(false); setInitialized(true)
    }
    void initialize()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!initialized) return
    saveBoundProjects(projects)
    saveBoundActiveProject(activeProject)
    for (const [projectPath, frame] of frames.current) publishActivation(frame, projectPath === activeProject)
  }, [projects, activeProject, initialized])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'wharness:project-ready') {
        const projectPath = String(event.data.projectPath || '')
        const frame = frames.current.get(projectPath)
        if (frame?.contentWindow === event.source) publishActivation(frame, projectPath === activeProject)
      }
      if (event.data?.type === 'wharness:unbind-project') {
        const projectPath = String(event.data.projectPath || '')
        if (projectPath) void unbindProject(projectPath)
      }
      if (event.data?.type === 'wharness:workspace-mode') {
        const projectPath = String(event.data.projectPath || '')
        const mode = event.data.mode === 'editor' ? 'editor' : event.data.mode === 'agent' ? 'agent' : event.data.mode === 'orchestrator' ? 'orchestrator' : undefined
        if (projectPath && mode) setProjectModes((current) => ({ ...current, [projectPath]: mode }))
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  })

  useEffect(() => {
    const windows = desktopBridge()?.windows
    if (!windows?.onActivateProject) return
    return windows.onActivateProject((payload) => {
      if (projects.includes(payload.projectPath)) setActiveProject(payload.projectPath)
    })
  }, [projects])

  // Keep iframe URLs stable across project switches. Hidden frames remain mounted so in-flight
  // work and page/UI state are preserved instead of being reloaded on activation.
  const frameSources = useMemo(() => new Map(projects.map((projectPath) => [projectPath, projectFrameURL(projectPath)])), [projects])

  async function bindProject(projectPath: string): Promise<boolean> {
    const requested = projectPath.trim()
    if (!requested || busy) return false
    setBusy(true); setError(undefined)
    try {
      const bridge = desktopBridge()
      const lock = bridge ? await bridge.projects.acquire(requested) as ProjectLockResult : { ok: true, path: requested }
      if (!lock.ok) throw new Error(lock.message || 'Este projeto já está aberto noutra janela do Wharnex.')
      const canonical = lock.path || requested
      if (!projects.includes(canonical) && projects.length >= MAX_BOUND_PROJECTS) {
        if (bridge) await bridge.projects.release(canonical)
        throw new Error(`Esta janela já atingiu o limite de ${MAX_BOUND_PROJECTS} projetos vinculados.`)
      }
      if (!projects.includes(canonical)) setProjects((current) => [...current, canonical])
      rememberRecent(canonical); setRecent(loadRecentWorkspaces()); setActiveProject(canonical)
      return true
    } catch (reason) { setError(messageOf(reason)); return false } finally { setBusy(false) }
  }

  async function chooseAndBind(): Promise<boolean> {
    const picked = await desktopBridge()?.projects.pickDirectory({ title: 'Vincular projeto' })
    if (!picked || picked.cancelled || !picked.path) return false
    return bindProject(picked.path)
  }

  async function unbindProject(projectPath: string) {
    if (busy) return
    setBusy(true); setError(undefined)
    try {
      await desktopBridge()?.projects.release(projectPath)
      const next = projects.filter((item) => item !== projectPath)
      frames.current.delete(projectPath)
      setProjects(next)
      if (activeProject === projectPath) setActiveProject(next[0] || '')
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }

  async function createProject(parentPath: string, name: string): Promise<boolean> {
    setBusy(true); setError(undefined)
    try {
      const created = await api.createProject(parentPath, name)
      setBusy(false)
      return await bindProject(created.project_path)
    } catch (reason) { setError(messageOf(reason)); setBusy(false); return false }
  }

  async function cloneProject(repositoryURL: string, parentPath: string, directory: string): Promise<boolean> {
    setBusy(true); setError(undefined)
    try {
      const cloned = await api.cloneProject(repositoryURL, parentPath, directory)
      setBusy(false)
      return await bindProject(cloned.project_path)
    } catch (reason) { setError(messageOf(reason)); setBusy(false); return false }
  }

  const chrome = <ShellChrome instanceID={INSTANCE_ID} version={config?.version} projects={projects} activeProject={activeProject} mode={projectModes[activeProject] || 'agent'} busy={busy} onActivate={setActiveProject} onMode={(mode) => sendToProject(frames.current.get(activeProject), { type: 'wharness:set-workspace-mode', mode })} onSettings={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:open-project-settings' })} onUnbind={() => void unbindProject(activeProject)} onBind={() => setLinkModalOpen(true)} onNewWindow={() => void desktopBridge()?.windows.open()} />
  const linkModal = linkModalOpen ? <ProjectLinkModal recent={recent} boundProjects={projects} busy={busy} error={error} onOpen={bindProject} onBrowse={chooseAndBind} onCreate={createProject} onClone={cloneProject} onClose={() => setLinkModalOpen(false)} /> : null

  if (!projects.length) return <div className="desktop-shell-root">
    {chrome}
    <Bootstrap config={config} busy={busy} error={error} recent={recent} restoring={busy} onStart={async (projectPath) => { await bindProject(projectPath) }} onCreate={async (parentPath, name) => { await createProject(parentPath, name) }} onClone={async (repositoryURL, parentPath, directory) => { await cloneProject(repositoryURL, parentPath, directory) }} />
    {linkModal}
  </div>

  return <main className="desktop-shell-root">
    {chrome}
    <ErrorToast open={Boolean(error)} message={error} shell onDismiss={() => setError(undefined)} />
    <section className="bound-project-stage">
      {projects.map((projectPath) => <iframe
        key={projectPath}
        ref={(node) => { if (node) frames.current.set(projectPath, node); else frames.current.delete(projectPath) }}
        className={`bound-project-frame ${projectPath === activeProject ? 'active' : ''}`}
        title={`Wharnex · ${projectName(projectPath)}`}
        src={frameSources.get(projectPath)}
        onLoad={(event) => publishActivation(event.currentTarget, projectPath === activeProject)}
      />)}
    </section>
    {linkModal}
  </main>
}

export function ShellChrome({ instanceID, version, projects, activeProject, mode, busy, onActivate, onMode, onSettings, onUnbind, onBind, onNewWindow }: {
  instanceID?: string
  version?: string
  projects: string[]; activeProject: string; busy: boolean
  mode: WorkspaceMode
  onActivate: (projectPath: string) => void; onMode: (mode: WorkspaceMode) => void; onSettings: () => void; onUnbind: () => void; onBind: () => void; onNewWindow: () => void
}) {
  const [projectActionsOpen, setProjectActionsOpen] = useState(false)
  const [projectWindowOpen, setProjectWindowOpen] = useState(false)
  const [projectWindows, setProjectWindows] = useState<ProjectWindowSnapshot>({ currentWindowId: desktopWindowScope(), items: [] })
  const [projectWindowAnchor, setProjectWindowAnchor] = useState<{ left: number; top: number; width: number }>()
  const [tunnelsOpen, setTunnelsOpen] = useState(false)
  const projectActionsRef = useRef<HTMLDivElement>(null)
  const projectWindowRef = useRef<HTMLDivElement>(null)
  const activeProjectButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!projectActionsOpen && !projectWindowOpen) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setProjectActionsOpen(false); setProjectWindowOpen(false) } }
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (projectActionsRef.current?.contains(event.target) || projectWindowRef.current?.contains(event.target) || activeProjectButtonRef.current?.contains(event.target)) return
      setProjectActionsOpen(false); setProjectWindowOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDown) }
  }, [projectActionsOpen, projectWindowOpen])

  async function toggleProjectWindowMenu(button: HTMLButtonElement) {
    if (projectWindowOpen) { setProjectWindowOpen(false); return }
    const rect = button.getBoundingClientRect()
    setProjectWindowAnchor({ left: rect.left, top: rect.bottom + 7, width: rect.width })
    setProjectActionsOpen(false); setProjectWindowOpen(true)
    const windows = desktopBridge()?.windows
    if (!windows?.projects) return
    try { setProjectWindows(await windows.projects()) } catch { /* local bindings remain available */ }
  }

  async function focusOpenProject(item: OpenProjectWindow) {
    setProjectWindowOpen(false)
    if (item.windowId === projectWindows.currentWindowId || projects.includes(item.projectPath)) { onActivate(item.projectPath); return }
    try { await desktopBridge()?.windows.focusProject(item.projectPath) } catch { /* owning window may have closed between snapshot and click */ }
  }

  const otherWindows = projectWindows.items.filter((item) => item.windowId !== projectWindows.currentWindowId)

  return <header className="multi-project-bar">
    <div className="multi-project-brand"><SignalCore size="compact" /></div>
    <InstanceBadge instanceID={instanceID} version={version} />
    {activeProject && <div className="shell-mode-switch" role="group" aria-label="Modo do workspace"><button className={mode === 'editor' ? 'active' : ''} onClick={() => onMode('editor')}><Icon name="code" size={14}/> Editor</button><button className={mode === 'agent' ? 'active' : ''} onClick={() => onMode('agent')}><Icon name="agent" size={14}/> Agent</button><button className={mode === 'orchestrator' ? 'active' : ''} onClick={() => onMode('orchestrator')}><Icon name="plan" size={14}/> Orchestrator</button></div>}
    <nav className="project-quick-switch" aria-label="Projetos vinculados">
      {projects.map((projectPath) => {
        const active = projectPath === activeProject
        return <button key={projectPath} ref={active ? activeProjectButtonRef : undefined} style={projectAccentStyle(projectPath)} className={active ? 'active' : ''} onClick={(event) => active ? void toggleProjectWindowMenu(event.currentTarget) : onActivate(projectPath)} title={active ? `${projectPath} · clique para ver projetos abertos` : projectPath} aria-expanded={active ? projectWindowOpen : undefined}>
          <span className="project-color-mark"><Icon name="workspace" size={13}/></span><span>{projectName(projectPath)}</span>{active && <Icon name="chevron" size={11}/>}
        </button>
      })}
    </nav>
    <div className="multi-project-actions">
      <button type="button" onClick={() => setTunnelsOpen(true)} aria-label="Túneis ativos" title="Túneis ativos"><Icon name="network" size={14}/></button>
      <ThemeToggle compact />
      <div ref={projectActionsRef} className="project-actions-menu">
        <button type="button" className="project-actions-trigger" disabled={busy} onClick={() => { setProjectWindowOpen(false); setProjectActionsOpen((current) => !current) }} aria-label="Ações de projeto" aria-expanded={projectActionsOpen} title="Ações de projeto"><Icon name="plus" size={15}/></button>
        {projectActionsOpen && <div className="project-actions-popover" role="menu" data-chatgpt-overlay-blocker="true">
          <button type="button" role="menuitem" onClick={() => { setProjectActionsOpen(false); onBind() }}><Icon name="workspace" size={14}/><span><strong>Vincular projeto</strong><small>Recentes, novo, clone ou pasta</small></span></button>
          <button type="button" role="menuitem" onClick={() => { setProjectActionsOpen(false); onNewWindow() }}><Icon name="external" size={14}/><span><strong>Nova janela</strong><small>Workspace independente</small></span></button>
        </div>}
      </div>
      {activeProject && <button type="button" disabled={busy} onClick={onSettings} aria-label="Configuração do projeto" title="Configuração do projeto"><Icon name="settings" size={14}/></button>}
      {activeProject && <button type="button" disabled={busy} onClick={onUnbind} aria-label="Fechar workspace" title="Fechar workspace"><Icon name="close" size={14}/></button>}
    </div>
    {projectWindowOpen && projectWindowAnchor && <div ref={projectWindowRef} className="project-window-popover" data-chatgpt-overlay-blocker="true" style={{ left: projectWindowAnchor.left, top: projectWindowAnchor.top, minWidth: Math.max(270, projectWindowAnchor.width + 90) }}>
      <div className="project-window-popover-heading"><span>Projetos abertos</span><small>Troque nesta janela ou traga outra para a frente.</small></div>
      <div className="project-window-group"><b>Nesta janela</b>{projects.map((projectPath) => <button type="button" key={projectPath} className={projectPath === activeProject ? 'current' : ''} style={projectAccentStyle(projectPath)} onClick={() => { setProjectWindowOpen(false); onActivate(projectPath) }}><span className="project-window-accent"/><span><strong>{projectName(projectPath)}</strong><small>{projectPath === activeProject ? 'Projeto atual' : 'Vinculado nesta janela'}</small></span>{projectPath === activeProject && <Icon name="check" size={13}/>}</button>)}</div>
      <div className="project-window-group"><b>Outras janelas</b>{otherWindows.length ? otherWindows.map((item) => <button type="button" key={`${item.windowId}:${item.projectPath}`} style={projectAccentStyle(item.projectPath)} onClick={() => void focusOpenProject(item)}><span className="project-window-accent"/><span><strong>{projectName(item.projectPath)}</strong><small>{item.focused ? 'Janela atualmente em foco' : 'Trazer janela para a frente'}</small></span><Icon name="external" size={12}/></button>) : <p>Nenhum outro projeto aberto noutra janela.</p>}</div>
    </div>}
    {tunnelsOpen && <TunnelOverviewModal onClose={() => setTunnelsOpen(false)}/>}
  </header>
}

function projectFrameURL(projectPath: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('embedded', '1')
  url.searchParams.set('project', projectPath)
  url.searchParams.delete('active')
  return url.toString()
}

function publishActivation(frame: HTMLIFrameElement, active: boolean) {
  try { frame.contentWindow?.postMessage({ type: 'wharness:project-active', active }, window.location.origin) } catch { /* same-origin best effort */ }
}

function sendToProject(frame: HTMLIFrameElement | undefined, message: Record<string, string>) {
  try { frame?.contentWindow?.postMessage(message, window.location.origin) } catch { /* same-origin best effort */ }
}

function stableProjectHue(projectPath: string) {
  let hash = 2166136261
  for (let index = 0; index < projectPath.length; index += 1) hash = Math.imul(hash ^ projectPath.charCodeAt(index), 16777619)
  return Math.abs(hash >>> 0) % 360
}

function projectAccentStyle(projectPath: string) { return { '--project-hue': stableProjectHue(projectPath) } as CSSProperties }
function projectName(projectPath: string) { return projectPath.split('/').filter(Boolean).at(-1) || projectPath }
function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Erro inesperado' }

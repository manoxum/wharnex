import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { api } from '../lib/api'
import { desktopBridge } from '../lib/desktop'
import { desktopWindowScope, loadBoundActiveProject, loadBoundProjects, saveBoundActiveProject, saveBoundProjects } from '../lib/projectBindings'
import { loadActiveWorkspace, loadRecentWorkspaces, rememberRecent } from '../lib/workspaceMemory'
import type { AppConfig, WorkspaceMode } from '../types'
import { Bootstrap } from './Bootstrap'
import { Icon } from './Icon'
import { QuickSwitcher } from './QuickSwitcher'
import { ErrorToast } from './ErrorToast'
import { TunnelOverviewModal } from './TunnelOverviewModal'
import { ProjectGitBadge } from './ProjectGitBadge'
import { SignalCore } from './SignalCore'
import { ProjectLinkModal } from './ProjectLinkModal'

type ProjectLockResult = { ok: boolean; path: string; ownerWindowId?: string; message?: string }
type OpenProjectWindow = { windowId: string; projectPath: string; focused: boolean }
type ProjectWindowSnapshot = { currentWindowId: string; items: OpenProjectWindow[] }
type ProjectRuntimeState = { selfEvolution: boolean; instanceId: string }
type ProjectAttentionState = { total: number; urgent: number; actionable: number }

const MAX_BOUND_PROJECTS = 12
export function WorkspaceShell() {
  const [config, setConfig] = useState<AppConfig>()
  const [projects, setProjects] = useState<string[]>([])
  const [activeProject, setActiveProject] = useState('')
  const [projectModes, setProjectModes] = useState<Record<string, WorkspaceMode>>({})
  const [projectSessions, setProjectSessions] = useState<Record<string, string>>({})
  const [projectRuntime, setProjectRuntime] = useState<Record<string, ProjectRuntimeState>>({})
  const [projectAttention, setProjectAttention] = useState<Record<string, ProjectAttentionState>>({})
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
    for (const [projectPath, frame] of frames.current) publishActivation(frame, projectPath === activeProject, projects)
  }, [projects, activeProject, initialized])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'wharness:project-ready') {
        const projectPath = String(event.data.projectPath || '')
        const frame = frames.current.get(projectPath)
        if (frame?.contentWindow === event.source) publishActivation(frame, projectPath === activeProject, projects)
      }
      if (event.data?.type === 'wharness:project-session') {
        const projectPath = String(event.data.projectPath || '')
        const sessionID = String(event.data.sessionId || '')
        const frame = frames.current.get(projectPath)
        if (projectPath && frame?.contentWindow === event.source) setProjectSessions((current) => ({ ...current, [projectPath]: sessionID }))
      }
      if (event.data?.type === 'wharness:project-runtime') {
        const projectPath = String(event.data.projectPath || '')
        const frame = frames.current.get(projectPath)
        if (projectPath && frame?.contentWindow === event.source) {
          setProjectRuntime((current) => ({
            ...current,
            [projectPath]: {
              selfEvolution: Boolean(event.data.selfEvolution),
              instanceId: String(event.data.instanceId || ''),
            },
          }))
        }
      }
      if (event.data?.type === 'wharness:project-attention') {
        const projectPath = String(event.data.projectPath || '')
        const frame = frames.current.get(projectPath)
        if (projectPath && frame?.contentWindow === event.source) {
          const count = (value: unknown) => Math.max(0, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0)
          setProjectAttention((current) => ({ ...current, [projectPath]: { total: count(event.data.total), urgent: count(event.data.urgent), actionable: count(event.data.actionable) } }))
        }
      }
      if (event.data?.type === 'wharness:unbind-project') {
        const projectPath = String(event.data.projectPath || '')
        if (projectPath) void unbindProject(projectPath)
      }
      // Bring a project to the front from inside one of the bound frames.
      //
      // The three cases are genuinely different and only the shell can tell
      // them apart: already bound here is a local activation, open in another
      // window has to raise that window, and anything else has to be bound
      // first or the request resolves to nothing at all.
      if (event.data?.type === 'wharness:focus-project') {
        const projectPath = String(event.data.projectPath || '')
        if (projectPath) void focusProject(projectPath)
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
      setProjectSessions((current) => { const nextSessions = { ...current }; delete nextSessions[projectPath]; return nextSessions })
      setProjectRuntime((current) => { const nextRuntime = { ...current }; delete nextRuntime[projectPath]; return nextRuntime })
      setProjects(next)
      if (activeProject === projectPath) setActiveProject(next[0] || '')
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(false) }
  }

  async function focusProject(projectPath: string) {
    const target = projectPath.trim()
    if (!target) return
    if (projects.includes(target)) { setActiveProject(target); return }
    try {
      const snapshot = await desktopBridge()?.windows.projects() as ProjectWindowSnapshot | undefined
      const elsewhere = snapshot?.items.find((item) => item.projectPath === target && item.windowId !== snapshot.currentWindowId)
      if (elsewhere) { await desktopBridge()?.windows.focusProject(target); return }
    } catch { /* fall through to binding it here */ }
    await bindProject(target)
  }

  useEffect(() => {
    if (activeProject) void desktopBridge()?.projects.activate?.(activeProject)
  }, [activeProject])

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

  const chrome = <ShellChrome projects={projects} activeProject={activeProject} activeSessionID={projectSessions[activeProject] || ''} activeRuntime={projectRuntime[activeProject]} activeAttention={projectAttention[activeProject]} mode={projectModes[activeProject] || 'agent'} busy={busy} onActivate={setActiveProject} onMode={(mode) => sendToProject(frames.current.get(activeProject), { type: 'wharness:set-workspace-mode', mode })} onGitSync={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:refresh-session' })} onAttention={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:open-attention' })} onSettings={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:open-project-settings' })} onUnbind={(projectPath) => void unbindProject(projectPath)} onBind={() => setLinkModalOpen(true)} onBindPath={(path) => void bindProject(path)} onNewWindow={() => void desktopBridge()?.windows.open()} />
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
        onLoad={(event) => publishActivation(event.currentTarget, projectPath === activeProject, projects)}
      />)}
    </section>
    {linkModal}
  </main>
}

export function ShellChrome({ projects, activeProject, activeSessionID, activeRuntime, activeAttention, mode, busy, onActivate, onMode, onGitSync, onAttention, onSettings, onUnbind, onBind, onBindPath, onNewWindow }: {
  projects: string[]; activeProject: string; activeSessionID?: string; activeRuntime?: ProjectRuntimeState; activeAttention?: ProjectAttentionState; busy: boolean
  mode: WorkspaceMode
  onActivate: (projectPath: string) => void; onMode: (mode: WorkspaceMode) => void; onGitSync?: () => void; onAttention?: () => void; onSettings: () => void; onUnbind: (projectPath: string) => void; onBind: () => void; onBindPath: (projectPath: string) => void; onNewWindow: () => void
}) {
  const [projectActionsOpen, setProjectActionsOpen] = useState(false)
  const [projectWindowOpen, setProjectWindowOpen] = useState(false)
  const [projectWindows, setProjectWindows] = useState<ProjectWindowSnapshot>({ currentWindowId: desktopWindowScope(), items: [] })
  const [projectWindowAnchor, setProjectWindowAnchor] = useState<{ left: number; top: number; width: number }>()
  const [tunnelsOpen, setTunnelsOpen] = useState(false)
  const [projectPath, setProjectPath] = useState('')
  const projectActionsRef = useRef<HTMLDivElement>(null)
  const projectWindowRef = useRef<HTMLDivElement>(null)
  const activeProjectButtonRef = useRef<HTMLButtonElement>(null)
  const useNativeWindowControls = false

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
  const orderedProjects = activeProject ? [activeProject, ...projects.filter((projectPath) => projectPath !== activeProject)] : projects

  return <header className="multi-project-bar" data-window-titlebar="true">
    <div className="multi-project-brand"><SignalCore size="compact" /></div>
    <nav className="project-quick-switch" aria-label="Projetos vinculados">
      {orderedProjects.map((projectPath) => {
        const active = projectPath === activeProject
        return <button key={projectPath} ref={active ? activeProjectButtonRef : undefined} style={projectAccentStyle(projectPath)} className={active ? 'active' : ''} onClick={(event) => active ? void toggleProjectWindowMenu(event.currentTarget) : onActivate(projectPath)} title={active ? `${projectPath} · clique para ver projetos abertos` : projectPath} aria-expanded={active ? projectWindowOpen : undefined}>
          <span className="project-color-mark"><Icon name="workspace" size={13}/></span><span>{projectName(projectPath)}</span>{active && <Icon name="chevron" size={11}/>}
        </button>
      })}
    </nav>
    {activeProject && <ProjectGitBadge sessionID={activeSessionID} busy={busy} onSync={onGitSync} />}
    {activeProject && <div className="shell-mode-switch" role="group" aria-label="Modo do workspace"><button className={mode === 'editor' ? 'active' : ''} onClick={() => onMode('editor')}><Icon name="code" size={14}/> Editor</button><button className={mode === 'agent' ? 'active' : ''} onClick={() => onMode('agent')}><Icon name="agent" size={14}/> Agent</button><button className={mode === 'orchestrator' ? 'active' : ''} onClick={() => onMode('orchestrator')}><Icon name="plan" size={14}/> Orchestrator</button></div>}
    {projects.length > 1 && <span className="multi-project-context" title="O Agent recebe contexto separado de todos os projetos vinculados; execução e Apply continuam isolados por projeto."><Icon name="bridge" size={12}/>{projects.length} projetos no contexto</span>}
    <div className="multi-project-actions">
      <button type="button" onClick={() => setTunnelsOpen(true)} aria-label="Túneis ativos" title="Túneis ativos"><Icon name="network" size={14}/></button>
      <QuickSwitcher compact />
      <div ref={projectActionsRef} className="project-actions-menu">
        <button type="button" className="project-actions-trigger" disabled={busy} onClick={() => { setProjectWindowOpen(false); setProjectActionsOpen((current) => !current) }} aria-label="Ações de projeto" aria-expanded={projectActionsOpen} title="Ações de projeto"><Icon name="plus" size={15}/></button>
        {projectActionsOpen && <div className="project-actions-popover" role="menu" data-chatgpt-overlay-blocker="true">
          <button type="button" role="menuitem" onClick={() => { setProjectActionsOpen(false); onBind() }}><Icon name="workspace" size={14}/><span><strong>Vincular projeto</strong><small>Recentes, novo, clone ou pasta</small></span></button>
          <label className="project-path-link"><span>Caminho completo</span><input aria-label="Caminho completo do projeto" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="/home/user/projeto" spellCheck={false}/><button type="button" role="menuitem" disabled={busy || !projectPath.trim()} onClick={() => { const path = projectPath.trim(); setProjectPath(''); setProjectActionsOpen(false); onBindPath(path) }}><Icon name="bridge" size={14}/><span><strong>Vincular por caminho</strong><small>Adiciona esta raiz ao workspace</small></span></button></label>
          <button type="button" role="menuitem" onClick={() => { setProjectActionsOpen(false); onNewWindow() }}><Icon name="external" size={14}/><span><strong>Nova janela</strong><small>Workspace independente</small></span></button>
        </div>}
      </div>
      {activeProject && <button type="button" data-attention-trigger="true" className={`workspace-attention-button${activeAttention?.total ? ' has-alerts' : ''}${activeAttention?.urgent ? ' urgent' : ''}`} onClick={onAttention} aria-label={`Centro de notificações, ${activeAttention?.total || 0} alerta(s), ${activeAttention?.urgent || 0} urgente(s), ${activeAttention?.actionable || 0} com ação`} title="Notificações · ver alertas recentes"><Icon name="bell" size={16}/>{Boolean(activeAttention?.total) && <b className="workspace-attention-count" aria-hidden="true">{activeAttention!.total > 99 ? '99+' : activeAttention!.total}</b>}</button>}
      {activeProject && <button type="button" disabled={busy} onClick={onSettings} aria-label="Configuração do projeto" title="Configuração do projeto"><Icon name="settings" size={14}/></button>}
      {activeProject && <button type="button" disabled={busy} onClick={() => onUnbind(activeProject)} aria-label="Desvincular projeto" title="Desvincular projeto desta janela"><Icon name="close" size={14}/></button>}
    </div>
    {!useNativeWindowControls && <div className="window-chrome-controls" role="group" aria-label="Controlos da janela">
      {(activeRuntime?.selfEvolution || activeRuntime?.instanceId) && <span className="window-runtime-badge self-evolution-badge"><Icon name="refresh" size={12}/>{activeRuntime.selfEvolution ? ' WHX · AUTO-EVOLUÇÃO' : ` WHX · EVOLUÇÃO DA INSTÂNCIA ${activeRuntime.instanceId}`}</span>}
      <button type="button" className="window-chrome-button minimize" onClick={() => void desktopBridge()?.windows.minimize()} aria-label="Minimizar janela" title="Minimizar"><span aria-hidden="true"/></button>
      <button type="button" className="window-chrome-button maximize" onClick={() => void desktopBridge()?.windows.toggleMaximize()} aria-label="Maximizar ou restaurar janela" title="Maximizar / restaurar"><span aria-hidden="true"/></button>
      <button type="button" className="window-chrome-button close" onClick={() => void desktopBridge()?.windows.close()} aria-label="Fechar janela" title="Fechar"><span aria-hidden="true"/></button>
    </div>}
    {projectWindowOpen && projectWindowAnchor && <div ref={projectWindowRef} className="project-window-popover" data-chatgpt-overlay-blocker="true" style={{ left: projectWindowAnchor.left, top: projectWindowAnchor.top, minWidth: Math.max(270, projectWindowAnchor.width + 90) }}>
      <div className="project-window-popover-heading"><span>Projetos abertos</span><small>Troque ou desvincule nesta janela; projetos de outras janelas podem ser trazidos para a frente.</small></div>
      <div className="project-window-group"><b>Nesta janela</b>{projects.map((projectPath) => <div key={projectPath} className={`project-window-local-row ${projectPath === activeProject ? 'current' : ''}`} style={projectAccentStyle(projectPath)}><button type="button" className="project-window-project" onClick={() => { setProjectWindowOpen(false); onActivate(projectPath) }}><span className="project-window-accent"/><span><strong>{projectName(projectPath)}</strong><small>{projectPath === activeProject ? 'Projeto atual' : 'Vinculado nesta janela'}</small></span>{projectPath === activeProject && <Icon name="check" size={13}/>}</button><button type="button" className="project-window-unbind" disabled={busy} onClick={() => { setProjectWindowOpen(false); onUnbind(projectPath) }} aria-label={`Desvincular ${projectName(projectPath)} desta janela`} title="Desvincular desta janela"><Icon name="close" size={12}/></button></div>)}</div>
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

function publishActivation(frame: HTMLIFrameElement, active: boolean, projects: string[]) {
  try { frame.contentWindow?.postMessage({ type: 'wharness:project-active', active, projects }, window.location.origin) } catch { /* same-origin best effort */ }
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

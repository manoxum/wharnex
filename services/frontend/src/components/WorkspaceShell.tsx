import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { api } from '../lib/api'
import { desktopBridge } from '../lib/desktop'
import { isDesktopTrayTunnelAction } from '../lib/desktopTray'
import { announceHeaderPopover, subscribeHeaderPopover, subscribeOtherHeaderPopover } from '../lib/headerPopover'
import { desktopWindowScope, loadBoundActiveProject, loadBoundProjects, rememberOpenedProject, saveBoundActiveProject, saveBoundProjects, syncOpenedProjectHistory } from '../lib/projectBindings'
import { loadActiveWorkspace, loadRecentWorkspaces, rememberRecent, removeRecent, savePendingProjectPrompt } from '../lib/workspaceMemory'
import type { AppConfig, WorkspaceMode } from '../types'
import { Bootstrap } from './Bootstrap'
import { Icon } from './Icon'
import { QuickSwitcher } from './QuickSwitcher'
import { ErrorToast } from './ErrorToast'
import { TunnelOverviewModal } from './TunnelOverviewModal'
import { ProjectGitBadge } from './ProjectGitBadge'
import { SignalCore } from './SignalCore'
import { DesktopCloseDialogHost } from './DesktopCloseDialogHost'
import { DesktopRecoveryDialog } from './DesktopRecoveryDialog'
import { WorkspaceSkeleton } from './Skeleton'

type ProjectLockResult = { ok: boolean; path: string; ownerWindowId?: string; message?: string }
type OpenProjectWindow = { windowId: string; projectPath: string; focused: boolean }
type ProjectWindowSnapshot = { currentWindowId: string; items: OpenProjectWindow[] }
type ProjectRuntimeState = { selfEvolution: boolean; instanceId: string }
type ProjectAttentionState = { total: number; urgent: number; actionable: number }

const MAX_BOUND_PROJECTS = 12
const COMPOSER_TYPING_PULSE_MS = 1600
export function WorkspaceShell() {
  const [config, setConfig] = useState<AppConfig>()
  const [projects, setProjects] = useState<string[]>([])
  const [activeProject, setActiveProject] = useState('')
  const [projectModes, setProjectModes] = useState<Record<string, WorkspaceMode>>({})
  const [projectSessions, setProjectSessions] = useState<Record<string, string>>({})
  const [projectRuntime, setProjectRuntime] = useState<Record<string, ProjectRuntimeState>>({})
  const [projectAttention, setProjectAttention] = useState<Record<string, ProjectAttentionState>>({})
  const [composerTypingProject, setComposerTypingProject] = useState('')
  const activeProjectRef = useRef(activeProject)
  activeProjectRef.current = activeProject
  const [recent, setRecent] = useState<string[]>(loadRecentWorkspaces())
  const [busy, setBusy] = useState(true)
  const [initialized, setInitialized] = useState(false)
  const [pendingRecovery, setPendingRecovery] = useState<{ projects: string[]; activeProject: string }>()
  const [readyProjects, setReadyProjects] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const composerTypingTimerRef = useRef<number | undefined>(undefined)

  const restore = useCallback(async (candidates: string[], preferred: string) => {
    const bridge = desktopBridge()
    const acquired: string[] = []
    for (const candidate of candidates) {
      try {
        const lock = await bridge?.projects.acquire(candidate)
        if (!bridge || lock?.ok) acquired.push(lock?.path || candidate)
      } catch { /* stale saved binding is ignored */ }
    }
    const active = acquired.includes(preferred) ? preferred : acquired[0] || ''
    setProjects(acquired); setActiveProject(active); saveBoundProjects(acquired); saveBoundActiveProject(active); void syncOpenedProjectHistory(acquired)
    setBusy(false); setInitialized(true)
  }, [])

  useEffect(() => {
    let alive = true; void syncOpenedProjectHistory(loadRecentWorkspaces())
    async function initialize() {
      try { if (alive) setConfig(await api.config()) } catch (reason) { if (alive) setError(messageOf(reason)) }
      const bridge = desktopBridge()
      let recovery: { active: boolean; projects: string[]; activeProject: string; pending?: boolean } | undefined
      try { recovery = await bridge?.windows.recovery?.() } catch { /* recovery is best-effort */ }
      if (!alive) return
      // A pending recovery is the saved session asking to be restored. The
      // decision used to be a native message box shown before any window
      // existed; it is now this window's own themed modal, so nothing is
      // acquired until the person answers it.
      if (recovery?.active && recovery.pending && recovery.projects.length) {
        setPendingRecovery({ projects: [...recovery.projects], activeProject: recovery.activeProject })
        setBusy(false)
        return
      }
      const legacy = desktopWindowScope() === 'primary' ? loadActiveWorkspace()?.projectPath || '' : ''
      const candidates = recovery?.active ? [...recovery.projects] : loadBoundProjects()
      if (!recovery?.active && !candidates.length && legacy) candidates.push(legacy)
      await restore(candidates, recovery?.active ? recovery.activeProject : loadBoundActiveProject())
    }
    void initialize()
    return () => { alive = false }
  }, [restore])

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
        if (frame?.contentWindow === event.source) {
          // The project has painted, so its skeleton can hand over.
          setReadyProjects((current) => (current.includes(projectPath) ? current : [...current, projectPath]))
          publishActivation(frame, projectPath === activeProject, projects)
        }
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
      if (event.data?.type === 'wharness:composer-typing') {
        const projectPath = String(event.data.projectPath || '')
        const frame = frames.current.get(projectPath)
        if (projectPath && projectPath === activeProjectRef.current && frame?.contentWindow === event.source) {
          setComposerTypingProject(projectPath)
          if (composerTypingTimerRef.current !== undefined) window.clearTimeout(composerTypingTimerRef.current)
          composerTypingTimerRef.current = window.setTimeout(() => {
            setComposerTypingProject((current) => current === projectPath ? '' : current)
            composerTypingTimerRef.current = undefined
          }, COMPOSER_TYPING_PULSE_MS)
        }
      }
      if (event.data?.type === 'wharness:unbind-project') {
        const projectPath = String(event.data.projectPath || '')
        if (projectPath) void unbindProject(projectPath)
      }
      // The shell disambiguates local activation, another window and a new binding.
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

  useEffect(() => () => {
    if (composerTypingTimerRef.current !== undefined) window.clearTimeout(composerTypingTimerRef.current)
  }, [])

  useEffect(() => subscribeHeaderPopover((source) => {
    if (source !== 'attention') sendToProject(frames.current.get(activeProject), { type: 'wharness:close-header-overlays' })
  }), [activeProject])

  useEffect(() => {
    const windows = desktopBridge()?.windows
    if (!windows?.onActivateProject) return
    return windows.onActivateProject((payload) => {
      if (projects.includes(payload.projectPath)) setActiveProject(payload.projectPath)
    })
  }, [projects])

  useEffect(() => {
    const windows = desktopBridge()?.windows
    if (!windows?.onCloseProject) return
    return windows.onCloseProject((payload) => {
      if (projects.includes(payload.projectPath)) void unbindProject(payload.projectPath)
    })
  }, [projects, busy, activeProject])

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
      rememberRecent(canonical); setRecent(loadRecentWorkspaces()); setActiveProject(canonical); void rememberOpenedProject(canonical).catch(() => undefined)
      return true
    } catch (reason) { setError(messageOf(reason)); return false } finally { setBusy(false) }
  }

  async function chooseAndBind(): Promise<boolean> {
    const picked = await desktopBridge()?.projects.pickDirectory({ title: 'Vincular projeto' })
    if (!picked || picked.cancelled || !picked.path) return false
    return bindProject(picked.path)
  }

  async function openProjectWindow(projectPath: string) {
    const target = projectPath.trim()
    if (!target) return
    const bridge = desktopBridge()
    if (!bridge) { await bindProject(target); return }
    try {
      const snapshot = await bridge.windows.projects() as ProjectWindowSnapshot
      const existing = snapshot.items.find((item) => item.projectPath === target)
      if (existing?.windowId === snapshot.currentWindowId && projects.includes(target)) { setActiveProject(target); return }
      if (existing) { await bridge.windows.focusProject(target); return }
      await bridge.windows.open({ projectPath: target })
    } catch (reason) { setError(messageOf(reason)) }
  }

  async function chooseAndOpenWindow() {
    const picked = await desktopBridge()?.projects.pickDirectory({ title: 'Abrir projeto numa nova janela' })
    if (!picked || picked.cancelled || !picked.path) return
    rememberRecent(picked.path); setRecent(loadRecentWorkspaces()); void rememberOpenedProject(picked.path).catch(() => undefined)
    await openProjectWindow(picked.path)
  }

  function forgetRecent(projectPath: string) {
    removeRecent(projectPath)
    setRecent(loadRecentWorkspaces())
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

  async function bootstrapProject(parentPath: string, name: string, prompt: string) {
    setBusy(true); setError(undefined)
    try {
      const created = await api.createProject(parentPath, name)
      savePendingProjectPrompt(created.project_path, prompt)
      setBusy(false)
      await bindProject(created.project_path)
    } catch (reason) { setError(messageOf(reason)); setBusy(false) }
  }

  const chrome = <ShellChrome projects={projects} recent={recent} activeProject={activeProject} composerTypingProject={composerTypingProject} activeSessionID={projectSessions[activeProject] || ''} activeRuntime={projectRuntime[activeProject]} activeAttention={projectAttention[activeProject]} mode={projectModes[activeProject] || 'agent'} busy={busy} onActivate={setActiveProject} onMode={(mode) => sendToProject(frames.current.get(activeProject), { type: 'wharness:set-workspace-mode', mode })} onGitSync={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:refresh-session' })} onAttention={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:open-attention' })} onSettings={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:open-project-settings' })} onUnbind={(projectPath) => void unbindProject(projectPath)} onLinkProject={(projectPath) => void bindProject(projectPath)} onOpenProject={(projectPath) => void openProjectWindow(projectPath)} onForgetProject={forgetRecent} onBrowseLink={() => void chooseAndBind()} onBrowseOpen={() => void chooseAndOpenWindow()} onNewWindow={() => void desktopBridge()?.windows.open()} />
  const recoveryModal = pendingRecovery ? <DesktopRecoveryDialog
    projects={pendingRecovery.projects}
    busy={busy}
    onRecover={() => {
      const accepted = pendingRecovery
      setPendingRecovery(undefined); setBusy(true)
      void restore(accepted.projects, accepted.activeProject)
    }}
    onDiscard={() => { setPendingRecovery(undefined); setBusy(false); setInitialized(true) }}
  /> : null

  if (!projects.length) return <div className="desktop-shell-root">
    {chrome}
    {recoveryModal}
    <Bootstrap config={config} busy={busy} error={error} recent={recent} restoring={busy} onStart={async (projectPath) => { await bindProject(projectPath) }} onCreate={async (parentPath, name) => { await createProject(parentPath, name) }} onClone={async (repositoryURL, parentPath, directory) => { await cloneProject(repositoryURL, parentPath, directory) }} onBootstrap={bootstrapProject} onRecentChanged={() => setRecent(loadRecentWorkspaces())} />
  </div>

  return <main className="desktop-shell-root">
    {chrome}
    <ErrorToast open={Boolean(error)} message={error} shell onDismiss={() => setError(undefined)} />
    <section className="bound-project-stage">
      {projects.map((projectPath) => <iframe
        key={projectPath}
        ref={(node) => { if (node) frames.current.set(projectPath, node); else frames.current.delete(projectPath) }}
        className={`bound-project-frame ${projectPath === activeProject ? 'active' : ''} ${readyProjects.includes(projectPath) ? '' : 'booting'}`}
        title={`Wharnex · ${projectName(projectPath)}`}
        src={frameSources.get(projectPath)}
        onLoad={(event) => publishActivation(event.currentTarget, projectPath === activeProject, projects)}
      />)}
      {/* The active project holds its own space with the shared skeleton while
          its frame boots, instead of showing a blank panel. */}
      {activeProject && !readyProjects.includes(activeProject) && <div className="bound-project-loading" aria-hidden="true"><WorkspaceSkeleton/></div>}
    </section>
    {recoveryModal}
  </main>
}

export function ShellChrome({ projects, recent = [], activeProject, composerTypingProject, activeSessionID, activeRuntime, activeAttention, mode, busy, onActivate, onMode, onGitSync, onAttention, onSettings, onUnbind, onLinkProject, onOpenProject, onForgetProject, onBrowseLink, onBrowseOpen, onNewWindow }: {
  projects: string[]; recent?: string[]; activeProject: string; composerTypingProject?: string; activeSessionID?: string; activeRuntime?: ProjectRuntimeState; activeAttention?: ProjectAttentionState; busy: boolean
  mode: WorkspaceMode
  onActivate: (projectPath: string) => void; onMode: (mode: WorkspaceMode) => void; onGitSync?: () => void; onAttention?: () => void; onSettings: () => void; onUnbind: (projectPath: string) => void
  onLinkProject?: (projectPath: string) => void; onOpenProject?: (projectPath: string) => void; onForgetProject?: (projectPath: string) => void; onBrowseLink?: () => void; onBrowseOpen?: () => void; onBind?: () => void; onNewWindow: () => void
}) {
  const [projectActionsOpen, setProjectActionsOpen] = useState(false)
  const [projectWindowOpen, setProjectWindowOpen] = useState(false)
  const [projectWindows, setProjectWindows] = useState<ProjectWindowSnapshot>({ currentWindowId: desktopWindowScope(), items: [] })
  const [projectWindowAnchor, setProjectWindowAnchor] = useState<{ left: number; top: number; width: number }>()
  const [tunnelsOpen, setTunnelsOpen] = useState(false)
  const projectActionsRef = useRef<HTMLDivElement>(null)
  const projectWindowRef = useRef<HTMLDivElement>(null)
  const activeProjectButtonRef = useRef<HTMLButtonElement>(null)
  const useNativeWindowControls = false

  useEffect(() => subscribeOtherHeaderPopover('project-list', () => setProjectWindowOpen(false)), [])
  useEffect(() => subscribeOtherHeaderPopover('project-actions', () => setProjectActionsOpen(false)), [])
  useEffect(() => subscribeOtherHeaderPopover('tunnels', () => setTunnelsOpen(false)), [])

  useEffect(() => {
    const tray = desktopBridge()?.tray
    if (!tray?.onAction) return
    return tray.onAction((event) => {
      if (!isDesktopTrayTunnelAction(event, projects)) return
      if (event.projectPath !== activeProject) onActivate(event.projectPath)
      announceHeaderPopover('tunnels')
      setTunnelsOpen(true)
    })
  }, [projects, activeProject, onActivate])

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
    announceHeaderPopover('project-list')
    const rect = button.getBoundingClientRect()
    setProjectWindowAnchor({ left: rect.left, top: rect.bottom + 7, width: rect.width })
    setProjectWindowOpen(true)
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
    <DesktopCloseDialogHost />
    <div className="multi-project-brand"><SignalCore size="compact" /></div>
    <nav className="project-quick-switch" aria-label="Projetos vinculados">
      {orderedProjects.map((projectPath) => {
        const active = projectPath === activeProject
        const composerTyping = active && composerTypingProject === projectPath
        return <div key={projectPath} style={projectAccentStyle(projectPath)} className={`project-tab-shell${active ? ' active' : ''}`}>
          <button ref={active ? activeProjectButtonRef : undefined} style={projectAccentStyle(projectPath)} className={`project-tab-main${active ? ' active' : ''}${composerTyping ? ' composer-typing-attention' : ''}`} onClick={(event) => { if (active) void toggleProjectWindowMenu(event.currentTarget); else { announceHeaderPopover('workspace-action'); onActivate(projectPath) } }} title={active ? `${projectPath} · clique para ver projetos abertos` : projectPath} aria-expanded={active ? projectWindowOpen : undefined}>
            <span className="project-color-mark"><Icon name="workspace" size={13}/></span><span>{projectName(projectPath)}</span>{active && <Icon name="chevron" size={11}/>}
          </button>
          <button type="button" className="project-tab-unbind" disabled={busy} onClick={() => { setProjectWindowOpen(false); onUnbind(projectPath) }} aria-label={`Desvincular ${projectName(projectPath)} desta janela`} title={`Desvincular ${projectName(projectPath)} desta janela`}><Icon name="close" size={11}/></button>
        </div>
      })}
    </nav>
    {activeProject && <ProjectGitBadge sessionID={activeSessionID} busy={busy} onSync={onGitSync} />}
    {activeProject && <div className="shell-mode-switch" role="group" aria-label="Modo do workspace"><button className={mode === 'editor' ? 'active' : ''} aria-label="Editor" title="Editor" onClick={() => { announceHeaderPopover('workspace-action'); onMode('editor') }}><Icon name="code" size={14}/></button><button className={mode === 'agent' ? 'active' : ''} aria-label="Agent" title="Agent" onClick={() => { announceHeaderPopover('workspace-action'); onMode('agent') }}><Icon name="agent" size={14}/></button><button className={mode === 'orchestrator' ? 'active' : ''} aria-label="Orchestrator" title="Orchestrator" onClick={() => { announceHeaderPopover('workspace-action'); onMode('orchestrator') }}><Icon name="plan" size={14}/></button></div>}
    {projects.length > 1 && <span className="multi-project-context" title="O Agent recebe contexto separado de todos os projetos vinculados; execução e Apply continuam isolados por projeto."><Icon name="bridge" size={12}/>{projects.length} projetos no contexto</span>}
    <div className="multi-project-actions">
      <button type="button" onClick={() => { announceHeaderPopover('tunnels'); setTunnelsOpen(true) }} aria-label="Túneis ativos" title="Túneis ativos"><Icon name="network" size={14}/></button>
      <QuickSwitcher compact />
      <div ref={projectActionsRef} className="project-actions-menu">
        <button type="button" className="project-actions-trigger" disabled={busy} onClick={() => { if (!projectActionsOpen) announceHeaderPopover('project-actions'); setProjectActionsOpen((current) => !current) }} aria-label="Ações de projeto" aria-expanded={projectActionsOpen} title="Ações de projeto"><Icon name="plus" size={15}/></button>
        {projectActionsOpen && <div className="project-actions-popover project-actions-hub" role="menu" data-chatgpt-overlay-blocker="true">
          <div className="project-actions-hub-heading"><span><strong>Projetos recentes</strong><small>Abrir, vincular ou remover desta lista.</small></span><b>{recent.length}</b></div>
          <div className="project-actions-recent-list">
            {recent.length ? recent.map((projectPath) => <div key={projectPath} className="project-actions-recent-row" style={projectAccentStyle(projectPath)}>
              <span className="project-actions-recent-mark"><Icon name="workspace" size={13}/></span>
              <span className="project-actions-recent-copy"><strong>{projectName(projectPath)}</strong><small>{projectPath}</small></span>
              <div className="project-actions-recent-buttons">
                <button type="button" disabled={busy} onClick={() => onForgetProject?.(projectPath)} title="Remover dos recentes" aria-label={`Remover ${projectName(projectPath)} dos recentes`}><Icon name="close" size={12}/></button>
                <button type="button" disabled={busy || projects.includes(projectPath)} onClick={() => { setProjectActionsOpen(false); onLinkProject?.(projectPath) }} title="Vincular nesta janela" aria-label={`Vincular ${projectName(projectPath)}`}><Icon name="link" size={12}/></button>
                <button type="button" disabled={busy} onClick={() => { setProjectActionsOpen(false); onOpenProject?.(projectPath) }} title="Abrir projeto" aria-label={`Abrir ${projectName(projectPath)}`}><Icon name="external" size={12}/></button>
              </div>
            </div>) : <div className="project-actions-empty"><Icon name="history" size={15}/><span>Nenhum projeto recente.</span></div>}
          </div>
          <div className="project-actions-hub-footer">
            <button type="button" role="menuitem" onClick={() => { setProjectActionsOpen(false); onNewWindow() }}><Icon name="plus" size={15}/><span><strong>Nova janela</strong><small>Início Wharnex</small></span></button>
            <button type="button" role="menuitem" onClick={() => { setProjectActionsOpen(false); onBrowseOpen?.() }}><Icon name="external" size={15}/><span><strong>Abrir</strong><small>Noutra janela</small></span></button>
            <button type="button" role="menuitem" onClick={() => { setProjectActionsOpen(false); onBrowseLink?.() }}><Icon name="link" size={15}/><span><strong>Vincular</strong><small>Nesta janela</small></span></button>
          </div>
        </div>}
      </div>
      {activeProject && <button type="button" data-attention-trigger="true" className={`workspace-attention-button${activeAttention?.total ? ' has-alerts' : ''}${activeAttention?.urgent ? ' urgent' : ''}`} onClick={() => { announceHeaderPopover('attention'); onAttention?.() }} aria-label={`Centro de notificações, ${activeAttention?.total || 0} alerta(s), ${activeAttention?.urgent || 0} urgente(s), ${activeAttention?.actionable || 0} com ação`} title="Notificações · ver alertas recentes"><Icon name="bell" size={16}/>{Boolean(activeAttention?.total) && <b className="workspace-attention-count" aria-hidden="true">{activeAttention!.total > 99 ? '99+' : activeAttention!.total}</b>}</button>}
      {activeProject && <button type="button" disabled={busy} onClick={() => { announceHeaderPopover('settings'); onSettings() }} aria-label="Configuração do projeto" title="Configuração do projeto"><Icon name="settings" size={14}/></button>}
    </div>
    {!useNativeWindowControls && <div className="window-chrome-controls" role="group" aria-label="Controlos da janela">
      {(activeRuntime?.selfEvolution || activeRuntime?.instanceId) && <span className="window-runtime-badge self-evolution-badge"><Icon name="refresh" size={12}/>{activeRuntime.selfEvolution ? ' WHX · AUTO-EVOLUÇÃO' : ` WHX · EVOLUÇÃO DA INSTÂNCIA ${activeRuntime.instanceId}`}</span>}
      <button type="button" className="window-chrome-button minimize" onClick={() => void desktopBridge()?.windows.minimize()} aria-label="Minimizar janela" title="Minimizar"><span aria-hidden="true"/></button>
      <button type="button" className="window-chrome-button maximize" onClick={() => void desktopBridge()?.windows.toggleMaximize()} aria-label="Maximizar ou restaurar janela" title="Maximizar / restaurar"><span aria-hidden="true"/></button>
      <button type="button" className="window-chrome-button close" onClick={() => void desktopBridge()?.windows.close()} aria-label="Fechar janela" title="Fechar"><span aria-hidden="true"/></button>
    </div>}
    {projectWindowOpen && projectWindowAnchor && <div ref={projectWindowRef} className="project-window-popover" data-chatgpt-overlay-blocker="true" style={{ left: projectWindowAnchor.left, top: projectWindowAnchor.top, minWidth: Math.max(270, projectWindowAnchor.width + 90) }}>
      <div className="project-window-popover-heading"><span>Projetos abertos</span><small>Troque ou desvincule nesta janela; projetos de outras janelas podem ser trazidos para a frente.</small></div>
      <div className="project-window-group"><b>Nesta janela</b>{projects.map((projectPath) => <div key={projectPath} className={`project-window-local-row ${projectPath === activeProject ? 'current' : ''}`} style={projectAccentStyle(projectPath)}><button type="button" className="project-window-project" onClick={() => { setProjectWindowOpen(false); onActivate(projectPath) }}><span className="project-window-accent"/><span><strong>{projectName(projectPath)}</strong><small>{projectPath === activeProject ? 'Projeto atual' : 'Vinculado nesta janela'}</small></span>{projectPath === activeProject && <Icon name="check" size={13}/>}</button><button type="button" className="project-window-unbind" disabled={busy} onClick={() => { setProjectWindowOpen(false); onUnbind(projectPath) }} aria-label={`Desvincular ${projectName(projectPath)} pelo menu de projetos`} title="Desvincular desta janela"><Icon name="close" size={12}/></button></div>)}</div>
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

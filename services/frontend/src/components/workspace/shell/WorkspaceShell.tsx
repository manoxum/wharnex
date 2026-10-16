import { ShellChrome } from './chrome'
export { ShellChrome } from './chrome'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { subscribeHeaderPopover } from '../../../lib/desktop/bridge/headerPopover'
import { desktopWindowScope, loadBoundActiveProject, loadBoundProjects, rememberOpenedProject, saveBoundActiveProject, saveBoundProjects, syncOpenedProjectHistory } from '../../../lib/project/context/projectBindings'
import { loadActiveWorkspace, loadRecentWorkspaces, rememberRecent, removeRecent, saveAutomationMode, saveEffortLevel, savePendingProjectLaunch, savePendingProjectPrompt, type BootstrapLaunchOptions } from '../../../lib/chat/history/workspaceMemory'
import type { AppConfig, WorkspaceMode } from '../../../types'
import { Bootstrap } from './Bootstrap'
import { ErrorToast } from '../../attention/center/ErrorToast'
import { DesktopRecoveryDialog } from '../window/DesktopRecoveryDialog'
import { WorkspaceSkeleton } from '../../presentation/chrome/Skeleton'
import { useTerminalCloseGuard } from '../../terminal/workspace/useTerminalCloseGuard'
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
  const terminalClose = useTerminalCloseGuard(frames, projects, unbindProject, (message) => setError(message))
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
        if (projectPath) terminalClose.requestProjectClose(projectPath)
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
      if (projects.includes(payload.projectPath)) terminalClose.requestProjectClose(payload.projectPath)
    })
  }, [projects, busy, activeProject, terminalClose])

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

  async function bootstrapProject(parentPath: string, name: string, prompt: string, options: BootstrapLaunchOptions) {
    setBusy(true); setError(undefined)
    try {
      const created = await api.createProject(parentPath, name)
      savePendingProjectPrompt(created.project_path, prompt)
      savePendingProjectLaunch(created.project_path, options)
      saveAutomationMode(created.project_path, options.automationMode)
      saveEffortLevel(created.project_path, options.effortLevel)
      setBusy(false)
      await bindProject(created.project_path)
    } catch (reason) { setError(messageOf(reason)); setBusy(false) }
  }

  const chrome = <ShellChrome projects={projects} recent={recent} activeProject={activeProject} composerTypingProject={composerTypingProject} activeSessionID={projectSessions[activeProject] || ''} terminalProcesses={terminalClose.windowTerminals} activeRuntime={projectRuntime[activeProject]} activeAttention={projectAttention[activeProject]} mode={projectModes[activeProject] || 'agent'} busy={busy} onActivate={setActiveProject} onMode={(mode) => sendToProject(frames.current.get(activeProject), { type: 'wharness:set-workspace-mode', mode })} onCommands={() => sendToProject(frames.current.get(activeProject), { type: 'wharnex:open-commands' })} onGitSync={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:refresh-session' })} onAttention={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:open-attention' })} onSettings={() => sendToProject(frames.current.get(activeProject), { type: 'wharness:open-project-settings' })} onUnbind={terminalClose.requestProjectClose} onLinkProject={(projectPath) => void bindProject(projectPath)} onOpenProject={(projectPath) => void openProjectWindow(projectPath)} onForgetProject={forgetRecent} onBrowseLink={() => void chooseAndBind()} onBrowseOpen={() => void chooseAndOpenWindow()} onNewWindow={() => void desktopBridge()?.windows.open()} />
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
    {terminalClose.dialog}
    {recoveryModal}
    <Bootstrap config={config} busy={busy} error={error} recent={recent} restoring={busy} onStart={async (projectPath) => { await bindProject(projectPath) }} onCreate={async (parentPath, name) => { await createProject(parentPath, name) }} onClone={async (repositoryURL, parentPath, directory) => { await cloneProject(repositoryURL, parentPath, directory) }} onBootstrap={bootstrapProject} onRecentChanged={() => setRecent(loadRecentWorkspaces())} />
  </div>

  return <main className="desktop-shell-root">
    {chrome}
    {terminalClose.dialog}
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

function messageOf(error: unknown) { return error instanceof Error ? error.message : 'Erro inesperado' }

function projectName(projectPath: string) { return projectPath.split('/').filter(Boolean).at(-1) || projectPath }

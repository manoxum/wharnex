import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { WorkspaceMode } from '../../../../types'
import type { TerminalRuntimeRecord } from '../../../terminal/runtime/terminalRuntime'
import { ProjectTabs } from '../../projects'
import { desktopBridge } from '../../../../lib/desktop/bridge/desktop'
import { isDesktopTrayTunnelAction } from '../../../../lib/desktop/bridge/desktopTray'
import { desktopWindowScope } from '../../../../lib/project/context/projectBindings'
import { announceHeaderPopover, subscribeOtherHeaderPopover } from '../../../../lib/desktop/bridge/headerPopover'
import { Icon } from '../../../presentation/chrome/Icon'
import { SignalCore } from '../../../presentation/chrome/SignalCore'
import { ProjectGitBadge } from '../../../git/history/ProjectGitBadge'
import { DesktopCloseDialogHost } from '../../window/DesktopCloseDialogHost'
import { TunnelOverviewModal } from '../../../project/settings/TunnelOverviewModal'
import { QuickSwitcher } from '../QuickSwitcher'
import { CommandLauncher } from '../commands'

type OpenProjectWindow = { windowId: string; projectPath: string; focused: boolean }
type ProjectWindowSnapshot = { currentWindowId: string; items: OpenProjectWindow[] }
type ProjectRuntimeState = { selfEvolution: boolean; instanceId: string }
type ProjectAttentionState = { total: number; urgent: number; actionable: number }

export function ShellChrome({ projects, recent = [], activeProject, composerTypingProject, activeSessionID, terminalProcesses, activeRuntime, activeAttention, mode, busy, onActivate, onMode, onCommands, onGitSync, onAttention, onSettings, onUnbind, onLinkProject, onOpenProject, onForgetProject, onBrowseLink, onBrowseOpen, onNewWindow }: {
  projects: string[]; recent?: string[]; activeProject: string; composerTypingProject?: string; activeSessionID?: string; terminalProcesses?: TerminalRuntimeRecord[]; activeRuntime?: ProjectRuntimeState; activeAttention?: ProjectAttentionState; busy: boolean
  mode: WorkspaceMode
  onCommands?: () => void
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

  useEffect(() => {
    if (!onCommands) return
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); onCommands() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [onCommands])

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
    const closePopups = () => { setProjectActionsOpen(false); setProjectWindowOpen(false) }
    const insideProjectPopup = (target: EventTarget | null) => target instanceof Node && (
      Boolean(projectActionsRef.current?.contains(target)) ||
      Boolean(projectWindowRef.current?.contains(target)) ||
      Boolean(activeProjectButtonRef.current?.contains(target))
    )
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closePopups() }
    const onPointerDown = (event: PointerEvent) => { if (!insideProjectPopup(event.target)) closePopups() }
    const onFocusIn = (event: FocusEvent) => { if (!insideProjectPopup(event.target)) closePopups() }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    window.addEventListener('blur', closePopups)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      window.removeEventListener('blur', closePopups)
    }
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

  function openRecentProject(projectPath: string) {
    setProjectActionsOpen(false)
    onOpenProject?.(projectPath)
  }

  const otherWindows = projectWindows.items.filter((item) => item.windowId !== projectWindows.currentWindowId)
  const orderedProjects = activeProject ? [activeProject, ...projects.filter((projectPath) => projectPath !== activeProject)] : projects

  return <header className="multi-project-bar" data-window-titlebar="true">
    <DesktopCloseDialogHost terminals={terminalProcesses || []} />
    <div className="multi-project-brand"><SignalCore size="compact" /></div>
    <ProjectTabs projects={orderedProjects} activeProject={activeProject} composerTypingProject={composerTypingProject} busy={busy}
      projectWindowOpen={projectWindowOpen} activeButtonRef={activeProjectButtonRef} accentStyle={projectAccentStyle} projectName={projectName}
      onActiveMenu={(button) => void toggleProjectWindowMenu(button)} onActivate={(path) => { announceHeaderPopover('workspace-action'); onActivate(path) }}
      onUnbind={(path) => { setProjectWindowOpen(false); onUnbind(path) }}/>

    {activeProject && <ProjectGitBadge sessionID={activeSessionID} busy={busy} onSync={onGitSync} />}
    {activeProject && <div className="shell-mode-switch" role="group" aria-label="Modo do workspace"><button className={mode === 'editor' ? 'active' : ''} aria-label="Editor" title="Editor" onClick={() => { announceHeaderPopover('workspace-action'); onMode('editor') }}><Icon name="code" size={14}/></button><button className={mode === 'agent' ? 'active' : ''} aria-label="Agent" title="Agent" onClick={() => { announceHeaderPopover('workspace-action'); onMode('agent') }}><Icon name="agent" size={14}/></button><button className={mode === 'orchestrator' ? 'active' : ''} aria-label="Orchestrator" title="Orchestrator" onClick={() => { announceHeaderPopover('workspace-action'); onMode('orchestrator') }}><Icon name="plan" size={14}/></button></div>}
    {projects.length > 1 && <span className="multi-project-context" title="O Agent recebe contexto separado de todos os projetos vinculados; execução e Apply continuam isolados por projeto."><Icon name="bridge" size={12}/>{projects.length} projetos no contexto</span>}
    <div className="multi-project-actions">
      {activeProject && <CommandLauncher onOpen={onCommands}/>}
      <button type="button" onClick={() => { announceHeaderPopover('tunnels'); setTunnelsOpen(true) }} aria-label="Túneis ativos" title="Túneis ativos"><Icon name="network" size={14}/></button>
      <QuickSwitcher compact />
      <div ref={projectActionsRef} className="project-actions-menu">
        <button type="button" className="project-actions-trigger" disabled={busy} onClick={() => { if (!projectActionsOpen) announceHeaderPopover('project-actions'); setProjectActionsOpen((current) => !current) }} aria-label="Ações de projeto" aria-expanded={projectActionsOpen} title="Ações de projeto"><Icon name="plus" size={15}/></button>
        {projectActionsOpen && <div className="project-actions-popover project-actions-hub" role="menu">
          <div className="project-actions-hub-heading"><span><strong>Projetos recentes</strong><small>Abrir, vincular ou remover desta lista.</small></span><b>{recent.length}</b></div>
          <div className="project-actions-recent-list">
            {recent.length ? recent.map((projectPath) => <div key={projectPath} className="project-actions-recent-row" style={projectAccentStyle(projectPath)}>
              <button type="button" className="project-actions-recent-open" disabled={busy} onClick={() => openRecentProject(projectPath)} title="Abrir projeto" aria-label={`Abrir projeto ${projectName(projectPath)} pela lista`}>
                <span className="project-actions-recent-mark"><Icon name="workspace" size={13}/></span>
                <span className="project-actions-recent-copy"><strong>{projectName(projectPath)}</strong><small>{projectPath}</small></span>
              </button>
              <div className="project-actions-recent-buttons">
                <button type="button" disabled={busy} onClick={() => onForgetProject?.(projectPath)} title="Remover dos recentes" aria-label={`Remover ${projectName(projectPath)} dos recentes`}><Icon name="close" size={12}/></button>
                <button type="button" disabled={busy || projects.includes(projectPath)} onClick={() => { setProjectActionsOpen(false); onLinkProject?.(projectPath) }} title="Vincular nesta janela" aria-label={`Vincular ${projectName(projectPath)}`}><Icon name="link" size={12}/></button>
                <button type="button" disabled={busy} onClick={() => openRecentProject(projectPath)} title="Abrir projeto" aria-label={`Abrir ${projectName(projectPath)}`}><Icon name="external" size={12}/></button>
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
    {projectWindowOpen && projectWindowAnchor && <div ref={projectWindowRef} className="project-window-popover" style={{ left: projectWindowAnchor.left, top: projectWindowAnchor.top, minWidth: Math.max(270, projectWindowAnchor.width + 90) }}>
      <div className="project-window-popover-heading"><span>Projetos abertos</span><small>Troque ou desvincule nesta janela; projetos de outras janelas podem ser trazidos para a frente.</small></div>
      <div className="project-window-group"><b>Nesta janela</b>{projects.map((projectPath) => <div key={projectPath} className={`project-window-local-row ${projectPath === activeProject ? 'current' : ''}`} style={projectAccentStyle(projectPath)}><button type="button" className="project-window-project" onClick={() => { setProjectWindowOpen(false); onActivate(projectPath) }}><span className="project-window-accent"/><span><strong>{projectName(projectPath)}</strong><small>{projectPath === activeProject ? 'Projeto atual' : 'Vinculado nesta janela'}</small></span>{projectPath === activeProject && <Icon name="check" size={13}/>}</button><button type="button" className="project-window-unbind" disabled={busy} onClick={() => { setProjectWindowOpen(false); onUnbind(projectPath) }} aria-label={`Desvincular ${projectName(projectPath)} pelo menu de projetos`} title="Desvincular desta janela"><Icon name="close" size={12}/></button></div>)}</div>
      <div className="project-window-group"><b>Outras janelas</b>{otherWindows.length ? otherWindows.map((item) => <button type="button" key={`${item.windowId}:${item.projectPath}`} style={projectAccentStyle(item.projectPath)} onClick={() => void focusOpenProject(item)}><span className="project-window-accent"/><span><strong>{projectName(item.projectPath)}</strong><small>{item.focused ? 'Janela atualmente em foco' : 'Trazer janela para a frente'}</small></span><Icon name="external" size={12}/></button>) : <p>Nenhum outro projeto aberto noutra janela.</p>}</div>
    </div>}
    {tunnelsOpen && <TunnelOverviewModal onClose={() => setTunnelsOpen(false)}/>}
  </header>
}

function stableProjectHue(projectPath: string) {
  let hash = 2166136261
  for (let index = 0; index < projectPath.length; index += 1) hash = Math.imul(hash ^ projectPath.charCodeAt(index), 16777619)
  return Math.abs(hash >>> 0) % 360
}

function projectAccentStyle(projectPath: string) { return { '--project-hue': stableProjectHue(projectPath) } as CSSProperties }
function projectName(projectPath: string) { return projectPath.split('/').filter(Boolean).at(-1) || projectPath }

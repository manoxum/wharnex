import { lazy, Suspense, useEffect, useMemo, useState, type ComponentProps } from 'react'
import type { HarnessEvent, ProjectTodo, Session, TerminalRunInput } from '../types'
import { ChatPanel } from './ChatPanel'
import { Icon } from './Icon'
import { desktopWindowScope } from '../lib/projectBindings'
import { api } from '../lib/api'
import { summarizeAttention, type AttentionItem } from '../lib/attentionCenter'
import type { ExecutionFIFOItem } from '../lib/executionQueueView'
import { AttentionList } from './AttentionList'
import { PanelSkeleton } from './Skeleton'
import { DEFAULT_WORKSPACE_RAIL_LAYOUT, type WorkspaceRailSide, type WorkspaceTool } from '../lib/workspaceRailLayout'
import { defaultSidePanelWidth } from '../lib/workbenchPreferences'
import { drawerResizeCeiling, WORKBENCH_SIDE_PANEL_MIN_PX } from '../lib/workbenchResize'
import { InternalWindowPersistenceContext, usePersistentInternalWindowOwners } from '../lib/internalWindowPersistence'
import { ChatManagementDrawer } from './ChatManagementDrawer'

// Every drawer below is only ever rendered once the operator opens it, and
// most (Git graph, Postgres browser, artifact/knowledge explorers, runtime
// and task inspectors) are opened rarely if at all in a given session. They
// were still statically imported, so their code shipped in - and had to be
// parsed before - the very first paint. Loading each one's chunk on first
// open instead keeps that cost off the startup path entirely.
const AgentProjectExplorer = lazy(() => import('./AgentProjectExplorer').then((m) => ({ default: m.AgentProjectExplorer })))
const ExecutionErrorsDrawer = lazy(() => import('./ExecutionErrorsDrawer').then((m) => ({ default: m.ExecutionErrorsDrawer })))
const EvolutionEvidenceDrawer = lazy(() => import('./EvolutionEvidenceDrawer').then((m) => ({ default: m.EvolutionEvidenceDrawer })))
const ProjectKnowledgeDrawer = lazy(() => import('./ProjectKnowledgeDrawer').then((m) => ({ default: m.ProjectKnowledgeDrawer })))
const GitDrawer = lazy(() => import('./GitDrawer').then((m) => ({ default: m.GitDrawer })))
const AgentRuntimeDrawer = lazy(() => import('./AgentRuntimeDrawer').then((m) => ({ default: m.AgentRuntimeDrawer })))
const ProjectTasksDrawer = lazy(() => import('./ProjectTasksDrawer').then((m) => ({ default: m.ProjectTasksDrawer })))
const ArtifactExplorerPanel = lazy(() => import('./ArtifactExplorerPanel').then((m) => ({ default: m.ArtifactExplorerPanel })))
const DatabaseExplorerPanel = lazy(() => import('./DatabaseExplorerPanel').then((m) => ({ default: m.DatabaseExplorerPanel })))
const ProjectTodoPanel = lazy(() => import('./ProjectTodoPanel').then((m) => ({ default: m.ProjectTodoPanel })))
const DockerServicesPanel = lazy(() => import('./DockerServicesPanel').then((m) => ({ default: m.DockerServicesPanel })))

function DrawerFallback() {
  return <PanelSkeleton/>
}

export type Drawer = 'attention' | 'archive' | 'todo' | 'project' | 'library' | 'knowledge' | 'git' | 'agents' | 'tasks' | 'fifo' | 'evolution' | 'database' | 'docker' | 'errors' | ''

const DRAWERS: Exclude<Drawer, ''>[] = ['attention', 'archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'tasks', 'errors', 'fifo', 'evolution', 'database', 'docker']

const WORKSPACE_DRAWER_WIDTH_KEY = 'whx.workspace.drawer-width'
const WORKSPACE_RAIL_PX = 44
// A fifth of the usable workbench, so opening both side panels lands near the
// 20% / 60% / 20% split (see lib/workbenchPreferences) rather than on a fixed
// pixel width that means a different share on every screen.
const WORKSPACE_RIGHT_DRAWER_DEFAULT_PX = 460
const TOOL_DRAG_TYPE = 'application/x-wharnex-workspace-tool'
const PANEL_FONT_SCALE_KEY = 'whx.workspace.panel-font-scales.v1'
const PANEL_FONT_SCALE_MIN = 0.8
const PANEL_FONT_SCALE_MAX = 1.4
const PANEL_FONT_SCALE_STEP = 0.1
const EMPTY_WORKSPACE_RAIL_TOOLS: WorkspaceTool[] = []
const DEFAULT_STANDALONE_RAIL_TOOLS: WorkspaceTool[] = (() => {
  const base = [...DEFAULT_WORKSPACE_RAIL_LAYOUT.left, ...DEFAULT_WORKSPACE_RAIL_LAYOUT.pinned.left]
  return base.includes('project') ? base : [...base.slice(0, 2), 'project', ...base.slice(2)]
})()

function scopedKey(prefix: string, side: WorkspaceRailSide) { return `${prefix}:${side}:${desktopWindowScope()}` }

function loadWorkspaceDrawerWidth(side: WorkspaceRailSide) { const fallback = defaultSidePanelWidth() || (side === 'right' ? WORKSPACE_RIGHT_DRAWER_DEFAULT_PX : 0); try { return Number(localStorage.getItem(scopedKey(WORKSPACE_DRAWER_WIDTH_KEY, side))) || fallback } catch { return fallback } }
function saveWorkspaceDrawerWidth(side: WorkspaceRailSide, width: number) { try { localStorage.setItem(scopedKey(WORKSPACE_DRAWER_WIDTH_KEY, side), String(width)) } catch { /* best effort */ } }

export type WorkspaceSideRailProps = {
  session: Session
  busy: boolean
  drawer: Drawer
  onDrawer: (next: Drawer) => void
  chats: ComponentProps<typeof ChatPanel>['chats']
  chatProps?: ComponentProps<typeof ChatPanel>
  savedChats?: ComponentProps<typeof ChatPanel>['archivedChats']
  archivedChats: ComponentProps<typeof ChatPanel>['archivedChats']
  activeChatId: string
  activeEvents: HarnessEvent[]
  attentionItems: AttentionItem[]
  attentionHistoryItems?: AttentionItem[]
  executionFIFO: ExecutionFIFOItem[]
  activeExecutionCount: number
  onOpenAttention: (item: AttentionItem) => Promise<void>
  onAttentionAction: (item: AttentionItem) => Promise<void>
  onRestoreSavedChat?: (chatId: string) => Promise<void>
  onArchiveSavedChat?: (chatId: string) => Promise<void>
  onRestoreChat: ComponentProps<typeof ChatPanel>['onRestoreChat']
  onDeleteArchivedChat: ComponentProps<typeof ChatPanel>['onDeleteArchivedChat']
  onRenameChat: ComponentProps<typeof ChatPanel>['onRenameChat']
  onGenerateChatTitle: ComponentProps<typeof ChatPanel>['onGenerateChatTitle']
  onOpenFile: (path: string) => void
  explorerRevealPath?: string
  explorerRevealNonce?: number
  onAnalyzeEvolution?: (ids: string[]) => Promise<void>
  onError: (message: string) => void
  onSession?: (session: Session) => void
  onResolveConflictWithGPT?: (session: Session) => Promise<void>
  terminalOpen: boolean
  onToggleTerminal: () => void
  onRunInTerminal?: (input: TerminalRunInput) => void
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onGoToOrchestrator?: () => void
  onPromoteTodoToChat?: (todo: ProjectTodo) => Promise<void>
  onPromoteTodoToCurrentChat?: (todo: ProjectTodo) => Promise<void>
  onLocateTodoChat?: (chatId: string) => void
  onFollowInstance?: (agentId: string, chatId?: string, sessionId?: string) => void
  onFocusProject?: (projectPath: string) => void
  side?: WorkspaceRailSide
  tools?: WorkspaceTool[]
  pinnedTools?: WorkspaceTool[]
  onMoveTool?: (tool: WorkspaceTool, side: WorkspaceRailSide, before?: WorkspaceTool, pinned?: boolean) => void
  drawerWidth?: number
  onDrawerWidth?: (width: number) => void
}

type ToolMeta = { label: string; title: string; icon: ComponentProps<typeof Icon>['name']; drawer?: Exclude<Drawer, ''>; badge?: number }

export function WorkspaceSideRail(props: WorkspaceSideRailProps) {
  const { session, busy, drawer, onDrawer, archivedChats, attentionItems, executionFIFO, activeExecutionCount, onError } = props
  const attentionHistoryItems = props.attentionHistoryItems || []
  const savedChats = props.savedChats || []
  const side = props.side || 'left'
  const tools = props.tools || DEFAULT_STANDALONE_RAIL_TOOLS
  const pinnedTools = props.pinnedTools || EMPTY_WORKSPACE_RAIL_TOOLS
  const [localDrawerWidth, setLocalDrawerWidth] = useState(() => loadWorkspaceDrawerWidth(side))
  const drawerWidth = props.drawerWidth || localDrawerWidth
  const [pendingCommitCount, setPendingCommitCount] = useState(0)
  const [panelFontScales, setPanelFontScales] = useState<Partial<Record<Exclude<Drawer, ''>, number>>>(loadPanelFontScales)
  const [panelReloads, setPanelReloads] = useState<Partial<Record<Exclude<Drawer, ''>, number>>>({})
  const visibleTools = useMemo(() => tools.filter((tool) => tool !== 'evolution' || session.self_evolution), [session.self_evolution, tools])
  const visiblePinnedTools = useMemo(() => pinnedTools.filter((tool) => tool !== 'evolution' || session.self_evolution), [pinnedTools, session.self_evolution])

  useEffect(() => {
    if (!tools.includes('git') && !pinnedTools.includes('git') && drawer !== 'git') return
    let cancelled = false
    void (async () => {
      try { const overview = await api.gitOverview(session.id); if (!cancelled) setPendingCommitCount(overview.pending.length) }
      catch { if (!cancelled) setPendingCommitCount(0) }
    })()
    return () => { cancelled = true }
  }, [session.id, session.last_host_applied_at, drawer, pinnedTools, tools])

  const persistenceScope = `${session.project_path}\n${side}`
  const { mountedOwners: mountedDrawers, ownerFor: drawerOwner, register: registerPersistentWindow } = usePersistentInternalWindowOwners(persistenceScope, DRAWERS, drawer)
  const toggle = (next: Exclude<Drawer, ''>) => onDrawer(drawer === next ? '' : next)
  const closeDrawer = (candidate: Exclude<Drawer, ''>) => { if (drawer === candidate) onDrawer('') }
  const adjustPanelFontScale = (candidate: Exclude<Drawer, ''>, delta: number) => {
    setPanelFontScales((current) => {
      const value = current[candidate] || 1
      const nextValue = Math.min(PANEL_FONT_SCALE_MAX, Math.max(PANEL_FONT_SCALE_MIN, Math.round((value + delta) * 10) / 10))
      const next = { ...current, [candidate]: nextValue }
      savePanelFontScales(next)
      return next
    })
  }
  const reloadPanel = (candidate: Exclude<Drawer, ''>) => setPanelReloads((current) => ({ ...current, [candidate]: (current[candidate] || 0) + 1 }))

  function toolMeta(tool: WorkspaceTool): ToolMeta {
    if (tool === 'todo') return { label: 'TODO do projeto', title: 'Ideias, necessidades, erros e melhorias', icon: 'check', drawer: 'todo' }
    if (tool === 'archive') return { label: 'Gestão de chats', title: 'Chats guardados e arquivados', icon: 'archive', drawer: 'archive', badge: savedChats.length + archivedChats.length }
    if (tool === 'project') return { label: 'Explorador do projeto', title: 'Explorador do projeto', icon: 'workspace', drawer: 'project' }
    if (tool === 'library') return { label: 'Biblioteca de ficheiros', title: 'Biblioteca de ficheiros', icon: 'package', drawer: 'library' }
    if (tool === 'knowledge') return { label: 'Conhecimento do projeto', title: 'Conhecimento adquirido', icon: 'knowledge', drawer: 'knowledge' }
    if (tool === 'git') return { label: 'Git do projeto', title: 'Git do projeto', icon: 'git', drawer: 'git', badge: pendingCommitCount }
    if (tool === 'agents') return { label: 'Gestão de agentes', title: 'Supervisor e Workers', icon: 'agent', drawer: 'agents' }
    if (tool === 'tasks') return { label: 'Tarefas do projeto', title: 'Main Requests, subtarefas GPT, planos e execuções', icon: 'list', drawer: 'tasks' }
    if (tool === 'errors') return { label: 'Erros de execução', title: 'Ocorrências, causas, logs e soluções', icon: 'alert', drawer: 'errors' }
    if (tool === 'fifo') return { label: 'Fila FIFO de execução', title: 'Fila FIFO de execução', icon: 'play', drawer: 'fifo', badge: activeExecutionCount }
    if (tool === 'evolution') return { label: 'Logs de auto-evolução', title: 'Logs e análise de auto-evolução', icon: 'refresh', drawer: 'evolution' }
    if (tool === 'database') return { label: 'Database connection', title: 'Database connection', icon: 'database', drawer: 'database' }
    if (tool === 'docker') return { label: 'Docker', title: 'Containers, imagens, volumes e redes', icon: 'container', drawer: 'docker' }
    return { label: props.terminalOpen ? 'Fechar terminal' : 'Abrir terminal', title: props.terminalOpen ? 'Fechar terminal' : 'Abrir terminal do projeto', icon: 'terminal' }
  }

  function beginToolDrag(event: React.DragEvent<HTMLButtonElement>, tool: WorkspaceTool) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(TOOL_DRAG_TYPE, tool)
    event.dataTransfer.setData('text/plain', tool)
  }

  function droppedTool(event: React.DragEvent, before?: WorkspaceTool, pinned = false) {
    if (!props.onMoveTool) return
    event.preventDefault()
    event.stopPropagation()
    const value = event.dataTransfer.getData(TOOL_DRAG_TYPE) || event.dataTransfer.getData('text/plain')
    if (isWorkspaceTool(value)) props.onMoveTool(value, side, before, pinned)
  }

  function beginDrawerResize(event: React.PointerEvent<HTMLButtonElement>) {
    const body = event.currentTarget.closest('.workspace-body') as HTMLElement | null
    if (!body) return
    const rect = body.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    const update = (clientX: number) => {
      const minimum = WORKBENCH_SIDE_PANEL_MIN_PX
      const panel = body.querySelector(`.workspace-side-drawer-${side}`) as HTMLElement | null
      // Measures every sibling in the live row rather than assuming two rails
      // and one opposite drawer of a known class - the assumption that let one
      // splitter overrun a panel the other one owns. See lib/workbenchResize.
      const ceiling = panel ? drawerResizeCeiling(body, panel, minimum) : minimum
      const raw = side === 'left' ? clientX - rect.left - WORKSPACE_RAIL_PX : rect.right - clientX - WORKSPACE_RAIL_PX
      const next = Math.round(Math.max(minimum, Math.min(ceiling, raw)))
      setLocalDrawerWidth(next); saveWorkspaceDrawerWidth(side, next); props.onDrawerWidth?.(next)
    }
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX)
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish)
  }

  const renderTool = (tool: WorkspaceTool, pinned: boolean) => {
    const meta = toolMeta(tool)
    const active = tool === 'terminal' ? props.terminalOpen : meta.drawer === drawer
    return <button key={tool} type="button" draggable={Boolean(props.onMoveTool)} data-workspace-tool={tool} data-pinned={pinned ? 'true' : 'false'} className={`${active ? 'active' : ''} ${tool === 'terminal' ? 'workspace-rail-terminal' : ''}`.trim()} onDragStart={(event) => beginToolDrag(event, tool)} onDragOver={(event) => { if (props.onMoveTool) event.preventDefault() }} onDrop={(event) => droppedTool(event, tool, pinned)} onClick={() => tool === 'terminal' ? props.onToggleTerminal() : meta.drawer && toggle(meta.drawer)} aria-pressed={tool === 'terminal' ? props.terminalOpen : undefined} aria-label={meta.label} title={`${meta.title}${props.onMoveTool ? pinned ? ' · fixado em baixo · arraste para mover' : ' · arraste para reorganizar ou fixe em baixo' : ''}`}><Icon name={meta.icon} size={20}/>{Boolean(meta.badge) && <b>{meta.badge}</b>}</button>
  }

  const rail = <aside className={`agent-activity-bar workspace-side-rail workspace-side-rail-${side}`} aria-label={side === 'left' ? 'Ferramentas do workspace' : 'Ferramentas laterais direitas'} onDragOver={(event) => { if (props.onMoveTool) event.preventDefault() }} onDrop={(event) => droppedTool(event)}>
    <div className="workspace-rail-primary">{visibleTools.map((tool) => renderTool(tool, false))}</div>
    {side === 'right' && <div className="workspace-agent-rail-slot" aria-label="Atalhos do Agent integrados"/>}
    <div className={`workspace-rail-pinned ${visiblePinnedTools.length ? 'has-tools' : ''}`} aria-label="Ferramentas fixadas no canto inferior" title="Arraste um ícone para aqui para o fixar no canto inferior" onDragOver={(event) => { if (props.onMoveTool) event.preventDefault() }} onDrop={(event) => droppedTool(event, undefined, true)}>
      {visiblePinnedTools.map((tool) => renderTool(tool, true))}
      {props.onMoveTool && <span className="workspace-rail-pin-target" aria-hidden="true"/>}
    </div>
  </aside>

  const drawerPanels = mountedDrawers.map((candidate) => {
    const close = () => closeDrawer(candidate)
    const active = candidate === drawer
    const owner = drawerOwner(candidate)
    const panelFontScale = panelFontScales[candidate] || 1
    const drawerStyle = {
      ...(drawerWidth ? { ['--workspace-drawer-width' as string]: `${drawerWidth}px` } : {}),
      ['--workspace-panel-font-scale' as string]: String(panelFontScale),
      ['--ui-font-scale' as string]: String(rootUIFontScale() * panelFontScale),
      ...(!active ? { display: 'none' } : {}),
    } as React.CSSProperties
    const panelLabel = drawerPanelLabel(candidate)
    return <aside key={candidate} hidden={!active} className={`agent-drawer workspace-side-drawer workspace-side-drawer-${side}`} style={drawerStyle}>
      <div className="workspace-panel-toolbar" role="toolbar" aria-label={`Ferramentas do painel ${panelLabel}`}>
        <button type="button" className="workspace-panel-font-control" onClick={() => adjustPanelFontScale(candidate, -PANEL_FONT_SCALE_STEP)} disabled={panelFontScale <= PANEL_FONT_SCALE_MIN} aria-label={`Diminuir texto do painel ${panelLabel}`} title="Diminuir texto">A−</button>
        <button type="button" className="workspace-panel-font-control" onClick={() => adjustPanelFontScale(candidate, PANEL_FONT_SCALE_STEP)} disabled={panelFontScale >= PANEL_FONT_SCALE_MAX} aria-label={`Aumentar texto do painel ${panelLabel}`} title="Aumentar texto">A+</button>
        <button type="button" onClick={() => reloadPanel(candidate)} aria-label={`Recarregar painel ${panelLabel}`} title="Recarregar painel"><Icon name="refresh" size={15}/></button>
        <button type="button" onClick={close} aria-label={`Fechar painel ${panelLabel}`} title="Fechar painel"><Icon name="close" size={15}/></button>
      </div>
      <InternalWindowPersistenceContext.Provider key={`${owner}:${panelReloads[candidate] || 0}`} value={{ owner, register: registerPersistentWindow }}>
        <Suspense fallback={<DrawerFallback/>}>
        {candidate === 'attention' ? <AttentionCenterDrawer items={attentionItems} historyItems={attentionHistoryItems} activeChatId={props.activeChatId} busy={busy} onOpen={props.onOpenAttention} onAction={props.onAttentionAction} onClose={close}/> : null}
        {candidate === 'todo' && props.chatProps ? <ProjectTodoPanel session={session} chatProps={props.chatProps} onClose={close} onPromoteToChat={props.onPromoteTodoToChat} onPromoteToCurrentChat={props.onPromoteTodoToCurrentChat} onLocateChat={props.onLocateTodoChat} onGoToOrchestrator={props.onGoToOrchestrator} onError={onError}/> : null}
        {candidate === 'archive' ? <ChatManagementDrawer projectPath={session.project_path} savedChats={savedChats} archivedChats={archivedChats} busy={busy} onRestoreSaved={props.onRestoreSavedChat} onArchiveSaved={props.onArchiveSavedChat} onRestoreArchived={props.onRestoreChat} onDeleteArchived={props.onDeleteArchivedChat} onRename={props.onRenameChat} onGenerate={props.onGenerateChatTitle} onClose={close}/> : null}
        {candidate === 'project' ? <AgentProjectExplorer session={session} onOpen={props.onOpenFile} onError={onError} onClose={close} revealPath={props.explorerRevealPath} revealNonce={props.explorerRevealNonce}/> : null}
        {candidate === 'library' ? <ArtifactExplorerPanel sessionId={session.id} onError={onError} onClose={close}/> : null}
        {candidate === 'knowledge' ? <ProjectKnowledgeDrawer session={session} onClose={close}/> : null}
        {candidate === 'git' ? <GitDrawer session={session} busy={busy} onClose={close} onError={onError} onSession={props.onSession} onResolveConflictWithGPT={props.onResolveConflictWithGPT}/> : null}
        {candidate === 'agents' ? <AgentRuntimeDrawer projectPath={session.project_path} chats={props.chats} onGoToChat={props.onGoToChat} onFocusProject={props.onFocusProject} onClose={close} onError={onError}/> : null}
        {candidate === 'tasks' ? <ProjectTasksDrawer projectPath={session.project_path} currentSession={session} chats={props.chats} savedChats={savedChats} archivedChats={archivedChats} activeChatId={props.activeChatId} activeEvents={props.activeEvents} onClose={close} onError={onError} onGoToChat={props.onGoToChat}/> : null}
        {candidate === 'errors' ? <ExecutionErrorsDrawer chats={[...props.chats, ...savedChats, ...archivedChats]} currentSession={session} activeChatId={props.activeChatId} onClose={close}/> : null}
        {candidate === 'fifo' ? <ExecutionQueueDrawer items={executionFIFO} onClose={close} onError={onError}/> : null}
        {candidate === 'evolution' && session.self_evolution ? <EvolutionEvidenceDrawer session={session} busy={busy} onAnalyze={props.onAnalyzeEvolution || (async () => undefined)} onClose={close}/> : null}
        {candidate === 'database' ? <div className="workspace-database-drawer"><DatabaseExplorerPanel onError={onError}/><button type="button" className="workspace-right-close" onClick={close} aria-label="Fechar painel lateral direito"><Icon name="close" size={12}/></button></div> : null}
        {candidate === 'docker' ? <DockerServicesPanel session={session} onError={onError} onClose={close} onRunInTerminal={props.onRunInTerminal}/> : null}
        </Suspense>
      </InternalWindowPersistenceContext.Provider>
    </aside>
  })
  const splitter = drawer ? <button type="button" className={`agent-drawer-splitter workspace-side-splitter workspace-side-splitter-${side}`} aria-label={`Redimensionar painel lateral ${side === 'left' ? 'esquerdo' : 'direito'}`} title="Arraste para redimensionar" onPointerDown={beginDrawerResize}/> : null

  return <>{side === 'left' ? <>{rail}{drawerPanels}{splitter}</> : <>{splitter}{drawerPanels}{rail}</>}</>
}

function panelFontScaleKey() { return `${PANEL_FONT_SCALE_KEY}:${desktopWindowScope()}` }
function loadPanelFontScales(): Partial<Record<Exclude<Drawer, ''>, number>> {
  try {
    const parsed = JSON.parse(localStorage.getItem(panelFontScaleKey()) || '{}') as Record<string, unknown>
    const scales: Partial<Record<Exclude<Drawer, ''>, number>> = {}
    for (const candidate of DRAWERS) {
      const value = Number(parsed[candidate])
      if (Number.isFinite(value)) scales[candidate] = Math.min(PANEL_FONT_SCALE_MAX, Math.max(PANEL_FONT_SCALE_MIN, value))
    }
    return scales
  } catch { return {} }
}
function savePanelFontScales(scales: Partial<Record<Exclude<Drawer, ''>, number>>) {
  try { localStorage.setItem(panelFontScaleKey(), JSON.stringify(scales)) } catch { /* best effort */ }
}
function rootUIFontScale() {
  if (typeof document === 'undefined') return 1
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-font-scale'))
  return Number.isFinite(value) && value > 0 ? value : 1
}
function drawerPanelLabel(drawer: Exclude<Drawer, ''>) {
  if (drawer === 'attention') return 'Centro de Alertas'
  if (drawer === 'archive') return 'Gestão de chats'
  if (drawer === 'todo') return 'TODO do projeto'
  if (drawer === 'project') return 'Explorador do projeto'
  if (drawer === 'library') return 'Biblioteca de ficheiros'
  if (drawer === 'knowledge') return 'Conhecimento do projeto'
  if (drawer === 'git') return 'Git do projeto'
  if (drawer === 'agents') return 'Gestão de agentes'
  if (drawer === 'tasks') return 'Tarefas do projeto'
  if (drawer === 'errors') return 'Erros de execução'
  if (drawer === 'fifo') return 'Fila FIFO de execução'
  if (drawer === 'evolution') return 'Logs de auto-evolução'
  if (drawer === 'database') return 'Database Studio'
  return 'Docker'
}

function isWorkspaceTool(value: string): value is WorkspaceTool {
  return ['archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'tasks', 'errors', 'fifo', 'evolution', 'terminal', 'database', 'docker'].includes(value)
}
function AttentionCenterDrawer({ items, historyItems, activeChatId, busy, onOpen, onAction, onClose }: { items: AttentionItem[]; historyItems: AttentionItem[]; activeChatId: string; busy: boolean; onOpen: (item: AttentionItem) => Promise<void>; onAction: (item: AttentionItem) => Promise<void>; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | 'urgent' | 'actionable' | 'history'>('all')
  const summary = summarizeAttention(items)
  const showingHistory = filter === 'history'
  const filteredItems = showingHistory ? historyItems : filter === 'urgent' ? items.filter((item) => item.tone === 'danger') : filter === 'actionable' ? items.filter((item) => Boolean(item.action)) : items
  return <section className="attention-center-drawer" aria-label="Centro de notificações">
    <header className="agent-drawer-heading">
      <div className="attention-center-heading">
        <span className="attention-center-symbol" aria-hidden="true"><Icon name="bell" size={17}/></span>
        <div><span className="panel-kicker">Atenção global</span><strong>Centro de Alertas</strong><small>Priorize bloqueios e ações sem sair do projeto.</small></div>
      </div>
      <button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar Centro de Alertas"><Icon name="close" size={13}/></button>
    </header>
    <div className="attention-center-summary" role="status" aria-live="polite" aria-atomic="true">
      <span><b>{summary.total}</b> {summary.total === 1 ? 'alerta ativo' : 'alertas ativos'}</span>
      <span className={summary.urgent ? 'danger' : ''}><b>{summary.urgent}</b> {summary.urgent === 1 ? 'urgente' : 'urgentes'}</span>
      <span><b>{summary.actionable}</b> com ação</span>
      <span><b>{summary.chats}</b> {summary.chats === 1 ? 'chat afetado' : 'chats afetados'}</span>
    </div>
    <nav className="attention-center-filters" aria-label="Filtrar Alertas">
      <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Todos <b>{summary.total}</b></button>
      <button type="button" aria-pressed={filter === 'urgent'} onClick={() => setFilter('urgent')}>Urgentes <b>{summary.urgent}</b></button>
      <button type="button" aria-pressed={filter === 'actionable'} onClick={() => setFilter('actionable')}>Com Ação <b>{summary.actionable}</b></button>
      <button type="button" aria-pressed={filter === 'history'} onClick={() => setFilter('history')}>Histórico <b>{historyItems.length}</b></button>
    </nav>
    <div className="attention-center-list">
      {filteredItems.length ? <AttentionList items={filteredItems} activeChatId={activeChatId} busy={busy} density="full" onOpen={onOpen} onAction={onAction}/> : <div className="agent-drawer-empty attention-empty"><Icon name="check" size={18}/><strong>{showingHistory ? 'Histórico vazio' : items.length ? 'Nenhum alerta neste filtro' : 'Nada requer atenção'}</strong><span>{showingHistory ? 'As tarefas concluídas que abrir ficam guardadas aqui.' : items.length ? 'Escolha outro filtro para rever os alertas ativos.' : 'Alertas de todos os chats abertos deste projeto aparecerão aqui.'}</span></div>}
    </div>
  </section>
}

// ExecutionConcurrencyControl exposes how many plans one project may verify at
// the same time. It is deliberately presented next to the queue it governs, so
// the ordered list and the limit that produces it are read together.
//
// Raising it is not free: each concurrent runner claims a full container
// memory allowance plus a complete project clone, so the cost is stated rather
// than left for the operator to discover through an out-of-disk failure.
function ExecutionConcurrencyControl({ onError }: { onError?: (message: string) => void }) {
  const [concurrency, setConcurrency] = useState<number>()
  const [max, setMax] = useState(1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    api.executionConcurrency()
      .then((value) => { if (active) { setConcurrency(value.concurrency); setMax(value.max) } })
      .catch(() => { /* the queue itself stays usable without the knob */ })
    return () => { active = false }
  }, [])

  const apply = async (next: number) => {
    setBusy(true)
    try {
      const value = await api.updateExecutionConcurrency(next)
      setConcurrency(value.concurrency)
      setMax(value.max)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Não foi possível alterar a concorrência')
    } finally {
      setBusy(false)
    }
  }

  if (concurrency === undefined) return null
  return <div className="execution-queue-concurrency">
    <div className="execution-queue-concurrency-copy">
      <label htmlFor="execution-concurrency">Execuções simultâneas</label>
      <small>Limite por projeto · cada execução reserva um clone</small>
    </div>
    <div className="execution-queue-concurrency-control">
      <select id="execution-concurrency" aria-label="Execuções simultâneas por projeto" value={concurrency} disabled={busy}
        onChange={(event) => void apply(Number(event.target.value))}>
        {Array.from({ length: max }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <span>/ {max}</span>
    </div>
  </div>
}

function ExecutionQueueDrawer({ items, onClose, onError }: { items: ExecutionFIFOItem[]; onClose: () => void; onError?: (message: string) => void }) {
  const running = items.filter((item) => item.status === 'running' || item.status === 'submitting')
  const waiting = items.filter((item) => item.status === 'queued')
  const recent = items.filter((item) => item.status === 'completed' || item.status === 'failed')
  return <section className="execution-queue-drawer" aria-label="Fila FIFO de execução">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Execução do projeto</span><strong>Fila FIFO</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar fila"><Icon name="close" size={13}/></button></header>
    <div className="execution-queue-overview" aria-label="Resumo da fila"><QueueMetric label="Em execução" value={running.length} tone="running"/><QueueMetric label="A aguardar" value={waiting.length} tone="queued"/><QueueMetric label="Recentes" value={recent.length} tone="completed"/></div>
    <p className="execution-queue-hint">Mostra apenas chats ativos: trabalho em curso, pendente e as 5 últimas execuções terminadas.</p>
    <ExecutionConcurrencyControl onError={onError}/>
    <div className="execution-queue-list">{items.length ? items.map((item) => <ExecutionQueueCard key={item.key} item={item}/>) : <div className="agent-drawer-empty">Sem trabalho ativo ou recente. A próxima execução aparecerá aqui assim que entrar na fila.</div>}</div>
  </section>
}

function QueueMetric({ label, value, tone }: { label: string; value: number; tone: 'running' | 'queued' | 'completed' }) {
  return <div className={`execution-queue-metric ${tone}`}><i aria-hidden="true"/><span>{label}</span><b>{value}</b></div>
}

function ExecutionQueueCard({ item }: { item: ExecutionFIFOItem }) {
  const state = executionQueueState(item)
  const timestamp = item.completedAt || item.addedAt
  return <article className={`execution-queue-card ${item.status}`}>
    <div className="execution-queue-copy">
      <div className="execution-queue-card-heading"><strong>{item.chatTitle}</strong><span className="execution-queue-state" aria-label={state.label}><Icon name={state.icon} size={11}/><b>{state.label}</b></span></div>
      <span><code>{item.planId}</code><time dateTime={new Date(timestamp).toISOString()}>{new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{item.status === 'queued' && <i className="execution-queue-order" aria-label={`Posição ${item.position || 1} na fila`}>#{String(item.position || 1).padStart(2, '0')}</i>}</span>
      <small>{state.detail}</small>
    </div>
  </article>
}

function executionQueueState(item: ExecutionFIFOItem): { label: string; detail: string; icon: 'play' | 'check' | 'close' | 'terminal' } {
  if (item.status === 'running') return { label: 'Em execução', detail: 'Processamento ativo neste momento', icon: 'play' }
  if (item.status === 'submitting') return { label: 'A iniciar', detail: 'A reservar o próximo slot de execução', icon: 'terminal' }
  if (item.status === 'queued') return { label: 'Na fila', detail: 'Em espera, com a ordem FIFO preservada', icon: 'terminal' }
  if (item.status === 'completed') return { label: 'Concluída', detail: 'Execução terminada com sucesso', icon: 'check' }
  return { label: 'Com erro', detail: 'Execução terminada com falha', icon: 'close' }
}

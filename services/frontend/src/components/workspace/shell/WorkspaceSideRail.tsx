import { lazy, Suspense, useEffect, useMemo, useState, type ComponentProps } from 'react'
import type { EvolutionKnowledgeRef, HarnessEvent, ProjectTodo, Session, TerminalRunInput } from '../../../types'
import { ChatPanel } from '../../chat/panel/ChatPanel'
import { Icon } from '../../presentation/chrome/Icon'
import { desktopWindowScope } from '../../../lib/project/context/projectBindings'
import { api } from '../../../lib/transport/http/api'
import { summarizeAttention, type AttentionItem } from '../../../lib/attention/center/attentionCenter'
import type { ExecutionFIFOItem } from '../../../lib/execution/history/executionQueueView'
import { AttentionList } from '../../attention/center/AttentionList'
import { PanelSkeleton } from '../../presentation/chrome/Skeleton'
import { DEFAULT_WORKSPACE_RAIL_LAYOUT, type WorkspaceRailSide, type WorkspaceTool } from '../../../lib/workspace/layout/workspaceRailLayout'
import { defaultSidePanelWidth } from '../../../lib/workspace/preferences/workbenchPreferences'
import { WORKSPACE_DRAWERS, workspaceDrawerLabel, type Drawer } from '../../../lib/workspace/layout/workspaceDrawer'
import { drawerResizeCeiling, WORKBENCH_SIDE_PANEL_MIN_PX } from '../../../lib/workspace/layout/workbenchResize'
import { InternalWindowPersistenceContext, usePersistentInternalWindowOwners } from '../../../lib/workspace/layout/internalWindowPersistence'
import { ChatManagementDrawer } from '../../chat/panel/ChatManagementDrawer'
import { useUITestingContextSync } from '../../project/ui-testing/useUITestingContextSync'
import { isWorkspaceTool, workspaceToolMeta } from './workspaceToolPresentation'

export type { Drawer } from '../../../lib/workspace/layout/workspaceDrawer'

// Every drawer below is only ever rendered once the operator opens it, and
// most (Git graph, Postgres browser, artifact/knowledge explorers, runtime
// and task inspectors) are opened rarely if at all in a given session. They
// were still statically imported, so their code shipped in - and had to be
// parsed before - the very first paint. Loading each one's chunk on first
// open instead keeps that cost off the startup path entirely.
const AgentProjectExplorer = lazy(() => import('../../agent/explorer/AgentProjectExplorer').then((m) => ({ default: m.AgentProjectExplorer })))
const ExecutionErrorsDrawer = lazy(() => import('../../execution/history/ExecutionErrorsDrawer').then((m) => ({ default: m.ExecutionErrorsDrawer })))
const EvolutionEvidenceDrawer = lazy(() => import('../../project/knowledge/EvolutionEvidenceDrawer').then((m) => ({ default: m.EvolutionEvidenceDrawer })))
const ProjectKnowledgeDrawer = lazy(() => import('../../project/knowledge/ProjectKnowledgeDrawer').then((m) => ({ default: m.ProjectKnowledgeDrawer })))
const GitDrawer = lazy(() => import('../../git/review/GitDrawer').then((m) => ({ default: m.GitDrawer })))
const AgentRuntimeDrawer = lazy(() => import('../../agent/runtime/AgentRuntimeDrawer').then((m) => ({ default: m.AgentRuntimeDrawer })))
const ExternalAgentsPanel = lazy(() => import('../../agent/runtime/ExternalAgentsPanel').then((m) => ({ default: m.ExternalAgentsPanel })))
const ProjectTasksDrawer = lazy(() => import('../../project/tasks/ProjectTasksDrawer').then((m) => ({ default: m.ProjectTasksDrawer })))
const ArtifactExplorerPanel = lazy(() => import('../../artifacts/explorer/ArtifactExplorerPanel').then((m) => ({ default: m.ArtifactExplorerPanel })))
const DatabaseExplorerPanel = lazy(() => import('../../database/browser/DatabaseExplorerPanel').then((m) => ({ default: m.DatabaseExplorerPanel })))
const ProjectTodoPanel = lazy(() => import('../../project/tasks/ProjectTodoPanel').then((m) => ({ default: m.ProjectTodoPanel })))
const DockerServicesPanel = lazy(() => import('../../docker/services/DockerServicesPanel').then((m) => ({ default: m.DockerServicesPanel })))
const UITestingPanel = lazy(() => import('../../project/ui-testing/UITestingPanel').then((m) => ({ default: m.UITestingPanel })))

function DrawerFallback() {
  return <PanelSkeleton/>
}

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
  onAnalyzeEvolution?: (ids: string[], knowledgeRefs?: EvolutionKnowledgeRef[], files?: File[], knowledgeOnly?: boolean) => Promise<void>
  onConsolidateKnowledge?: () => Promise<void>
  onError: (message: string) => void
  onSession?: (session: Session) => void
  onResolveConflictWithGPT?: (session: Session) => Promise<void>
  onOpenGitConflictChat?: (session: Session) => Promise<void>
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

export function WorkspaceSideRail(props: WorkspaceSideRailProps) {
  const { session, busy, drawer, onDrawer, archivedChats, attentionItems, executionFIFO, onError } = props
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

  useUITestingContextSync(session, drawer, tools, pinnedTools)

  const persistenceScope = `${session.project_path}\n${side}`
  const { mountedOwners: mountedDrawers, ownerFor: drawerOwner, register: registerPersistentWindow } = usePersistentInternalWindowOwners(persistenceScope, WORKSPACE_DRAWERS, drawer)
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
    const meta = workspaceToolMeta(tool, { terminalOpen: props.terminalOpen, pendingCommitCount, savedChatCount: savedChats.length + archivedChats.length })
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
    const panelLabel = workspaceDrawerLabel(candidate)
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
        {candidate === 'knowledge' ? <ProjectKnowledgeDrawer session={session} busy={busy} onConsolidate={props.onConsolidateKnowledge} onClose={close}/> : null}
        {candidate === 'git' ? <GitDrawer session={session} busy={busy} onClose={close} onError={onError} onSession={props.onSession} onResolveConflictWithGPT={props.onResolveConflictWithGPT} onOpenGitConflictChat={props.onOpenGitConflictChat}/> : null}
        {candidate === 'agents' ? <AgentRuntimeDrawer projectPath={session.project_path} chats={props.chats} onGoToChat={props.onGoToChat} onFocusProject={props.onFocusProject} onClose={close} onError={onError}/> : null}
        {candidate === 'external-agents' ? <ExternalAgentsPanel projectPath={session.project_path} onRunInTerminal={props.onRunInTerminal}/> : null}
        {candidate === 'tasks' ? <ProjectTasksDrawer projectPath={session.project_path} currentSession={session} chats={props.chats} savedChats={savedChats} archivedChats={archivedChats} activeChatId={props.activeChatId} activeEvents={props.activeEvents} executionFIFO={executionFIFO} onClose={close} onError={onError} onGoToChat={props.onGoToChat}/> : null}
        {candidate === 'errors' ? <ExecutionErrorsDrawer chats={[...props.chats, ...savedChats, ...archivedChats]} currentSession={session} activeChatId={props.activeChatId} onClose={close}/> : null}
        {candidate === 'evolution' && session.self_evolution ? <EvolutionEvidenceDrawer session={session} busy={busy} onAnalyze={props.onAnalyzeEvolution || (async () => undefined)} onClose={close}/> : null}
        {candidate === 'database' ? <div className="workspace-database-drawer"><DatabaseExplorerPanel onError={onError}/><button type="button" className="workspace-right-close" onClick={close} aria-label="Fechar painel lateral direito"><Icon name="close" size={12}/></button></div> : null}
        {candidate === 'ui-testing' ? <UITestingPanel session={session} onError={onError}/> : null}
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
    for (const candidate of WORKSPACE_DRAWERS) {
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

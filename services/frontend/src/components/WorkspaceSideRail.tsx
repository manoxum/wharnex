import { lazy, Suspense, useEffect, useMemo, useState, type ComponentProps } from 'react'
import type { HarnessEvent, ProjectTodo, Session } from '../types'
import { ChatPanel } from './ChatPanel'
import { promptDialog } from '../lib/appDialog'
import { Icon } from './Icon'
import { type ProjectActivityKind } from './ProjectActivityDrawer'
import { MarkdownContent } from './MarkdownContent'
import { loadChat } from '../lib/workspaceMemory'
import { desktopWindowScope } from '../lib/projectBindings'
import { api } from '../lib/api'
import { summarizeAttention, type AttentionItem } from '../lib/attentionCenter'
import type { ExecutionFIFOItem } from '../lib/executionQueueView'
import { AttentionList } from './AttentionList'
import { PanelSkeleton } from './Skeleton'
import { DEFAULT_WORKSPACE_RAIL_LAYOUT, type WorkspaceRailSide, type WorkspaceTool } from '../lib/workspaceRailLayout'
import { defaultSidePanelWidth } from '../lib/workbenchPreferences'
import { drawerResizeCeiling, WORKBENCH_SIDE_PANEL_MIN_PX } from '../lib/workbenchResize'

// Every drawer below is only ever rendered once the operator opens it, and
// most (Git graph, Postgres browser, artifact/knowledge explorers, runtime
// and task inspectors) are opened rarely if at all in a given session. They
// were still statically imported, so their code shipped in - and had to be
// parsed before - the very first paint. Loading each one's chunk on first
// open instead keeps that cost off the startup path entirely.
const AgentProjectExplorer = lazy(() => import('./AgentProjectExplorer').then((m) => ({ default: m.AgentProjectExplorer })))
const ProjectActivityDrawer = lazy(() => import('./ProjectActivityDrawer').then((m) => ({ default: m.ProjectActivityDrawer })))
const EvolutionEvidenceDrawer = lazy(() => import('./EvolutionEvidenceDrawer').then((m) => ({ default: m.EvolutionEvidenceDrawer })))
const ProjectKnowledgeDrawer = lazy(() => import('./ProjectKnowledgeDrawer').then((m) => ({ default: m.ProjectKnowledgeDrawer })))
const GitDrawer = lazy(() => import('./GitDrawer').then((m) => ({ default: m.GitDrawer })))
const AgentRuntimeDrawer = lazy(() => import('./AgentRuntimeDrawer').then((m) => ({ default: m.AgentRuntimeDrawer })))
const ChatAgentTasksDrawer = lazy(() => import('./ChatAgentTasksDrawer').then((m) => ({ default: m.ChatAgentTasksDrawer })))
const ArtifactExplorerPanel = lazy(() => import('./ArtifactExplorerPanel').then((m) => ({ default: m.ArtifactExplorerPanel })))
const DatabaseExplorerPanel = lazy(() => import('./DatabaseExplorerPanel').then((m) => ({ default: m.DatabaseExplorerPanel })))
const ProjectTodoPanel = lazy(() => import('./ProjectTodoPanel').then((m) => ({ default: m.ProjectTodoPanel })))

function DrawerFallback() {
  return <PanelSkeleton/>
}

export type Drawer = 'attention' | 'archive' | 'todo' | 'project' | 'library' | 'knowledge' | 'git' | 'agents' | 'tasks' | 'fifo' | 'evolution' | 'database' | ProjectActivityKind | ''

const WORKSPACE_DRAWER_WIDTH_KEY = 'whx.workspace.drawer-width'
const WORKSPACE_RAIL_PX = 44
// A quarter of the workbench, so opening both side panels lands on the
// 25% / 50% / 25% split (see lib/workbenchPreferences) rather than on a fixed
// pixel width that means a different share on every screen.
const WORKSPACE_RIGHT_DRAWER_DEFAULT_PX = 460
const TOOL_DRAG_TYPE = 'application/x-wharnex-workspace-tool'
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
  onAnalyzeEvolution?: (ids: string[]) => Promise<void>
  onError: (message: string) => void
  onSession?: (session: Session) => void
  terminalOpen: boolean
  onToggleTerminal: () => void
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onGoToOrchestrator?: () => void
  onPromoteTodoToChat?: (todo: ProjectTodo) => Promise<void>
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
  const savedChats = props.savedChats || []
  const side = props.side || 'left'
  const tools = props.tools || DEFAULT_STANDALONE_RAIL_TOOLS
  const pinnedTools = props.pinnedTools || EMPTY_WORKSPACE_RAIL_TOOLS
  const [localDrawerWidth, setLocalDrawerWidth] = useState(() => loadWorkspaceDrawerWidth(side))
  const drawerWidth = props.drawerWidth || localDrawerWidth
  const [pendingCommitCount, setPendingCommitCount] = useState(0)
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

  const toggle = (next: Exclude<Drawer, ''>) => onDrawer(drawer === next ? '' : next)
  const close = () => onDrawer('')

  function toolMeta(tool: WorkspaceTool): ToolMeta {
    if (tool === 'todo') return { label: 'TODO do projeto', title: 'Ideias, necessidades, erros e melhorias', icon: 'check', drawer: 'todo' }
    if (tool === 'archive') return { label: 'Gestão de chats', title: 'Chats guardados e arquivados', icon: 'archive', drawer: 'archive', badge: savedChats.length + archivedChats.length }
    if (tool === 'project') return { label: 'Explorador do projeto', title: 'Explorador do projeto', icon: 'workspace', drawer: 'project' }
    if (tool === 'library') return { label: 'Biblioteca de ficheiros', title: 'Biblioteca de ficheiros', icon: 'package', drawer: 'library' }
    if (tool === 'knowledge') return { label: 'Conhecimento do projeto', title: 'Conhecimento adquirido', icon: 'knowledge', drawer: 'knowledge' }
    if (tool === 'git') return { label: 'Git do projeto', title: 'Git do projeto', icon: 'git', drawer: 'git', badge: pendingCommitCount }
    if (tool === 'agents') return { label: 'Gestão de agentes', title: 'Supervisor e Workers', icon: 'agent', drawer: 'agents' }
    if (tool === 'tasks') return { label: 'Tarefas do runtime', title: 'Fila e tarefas em execução', icon: 'list', drawer: 'tasks' }
    if (tool === 'plans') return { label: 'Planos do projeto', title: 'Planos do projeto', icon: 'plan', drawer: 'plans' }
    if (tool === 'executions') return { label: 'Execuções do projeto', title: 'Execuções do projeto', icon: 'history', drawer: 'executions' }
    if (tool === 'fifo') return { label: 'Fila FIFO de execução', title: 'Fila FIFO de execução', icon: 'play', drawer: 'fifo', badge: activeExecutionCount }
    if (tool === 'evolution') return { label: 'Logs de auto-evolução', title: 'Logs e análise de auto-evolução', icon: 'refresh', drawer: 'evolution' }
    if (tool === 'database') return { label: 'Database connection', title: 'Database connection', icon: 'database', drawer: 'database' }
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

  const drawerPanel = drawer ? <aside className={`agent-drawer workspace-side-drawer workspace-side-drawer-${side}`} style={drawerWidth ? { ['--workspace-drawer-width' as string]: `${drawerWidth}px` } as React.CSSProperties : undefined}>
    <Suspense fallback={<DrawerFallback/>}>
    {drawer === 'attention' ? <AttentionCenterDrawer items={attentionItems} activeChatId={props.activeChatId} busy={busy} onOpen={props.onOpenAttention} onAction={props.onAttentionAction} onClose={close}/> : null}
    {drawer === 'todo' && props.chatProps ? <ProjectTodoPanel session={session} chatProps={props.chatProps} onClose={close} onPromoteToChat={props.onPromoteTodoToChat} onGoToOrchestrator={props.onGoToOrchestrator} onError={onError}/> : null}
    {drawer === 'archive' ? <ChatManagementDrawer projectPath={session.project_path} savedChats={savedChats} archivedChats={archivedChats} busy={busy} onRestoreSaved={props.onRestoreSavedChat} onArchiveSaved={props.onArchiveSavedChat} onRestoreArchived={props.onRestoreChat} onDeleteArchived={props.onDeleteArchivedChat} onRename={props.onRenameChat} onGenerate={props.onGenerateChatTitle} onClose={close}/> : null}
    {drawer === 'project' ? <AgentProjectExplorer session={session} onOpen={props.onOpenFile} onError={onError} onClose={close}/> : null}
    {drawer === 'library' ? <ArtifactExplorerPanel sessionId={session.id} onError={onError} onClose={close}/> : null}
    {drawer === 'knowledge' ? <ProjectKnowledgeDrawer session={session} onClose={close}/> : null}
    {drawer === 'git' ? <GitDrawer session={session} busy={busy} onClose={close} onError={onError} onSession={props.onSession}/> : null}
    {drawer === 'agents' ? <AgentRuntimeDrawer projectPath={session.project_path} chats={props.chats} onGoToChat={props.onGoToChat} onFocusProject={props.onFocusProject} onClose={close} onError={onError}/> : null}
    {drawer === 'tasks' ? <ChatAgentTasksDrawer projectPath={session.project_path} onClose={close} onError={onError} chats={props.chats} onGoToChat={props.onGoToChat} onGoToOrchestrator={props.onGoToOrchestrator} onFollowInstance={props.onFollowInstance}/> : null}
    {drawer === 'plans' || drawer === 'executions' ? <ProjectActivityDrawer kind={drawer} chats={[...props.chats, ...savedChats, ...archivedChats]} currentSession={session} activeChatId={props.activeChatId} activeEvents={props.activeEvents} onClose={close}/> : null}
    {drawer === 'fifo' ? <ExecutionQueueDrawer items={executionFIFO} onClose={close} onError={onError}/> : null}
    {drawer === 'evolution' && session.self_evolution ? <EvolutionEvidenceDrawer session={session} busy={busy} onAnalyze={props.onAnalyzeEvolution || (async () => undefined)} onClose={close}/> : null}
    {drawer === 'database' ? <div className="workspace-database-drawer"><DatabaseExplorerPanel onError={onError}/><button type="button" className="workspace-right-close" onClick={close} aria-label="Fechar painel lateral direito"><Icon name="close" size={12}/></button></div> : null}
    </Suspense>
  </aside> : null
  const splitter = drawer ? <button type="button" className={`agent-drawer-splitter workspace-side-splitter workspace-side-splitter-${side}`} aria-label={`Redimensionar painel lateral ${side === 'left' ? 'esquerdo' : 'direito'}`} title="Arraste para redimensionar" onPointerDown={beginDrawerResize}/> : null

  return <>{side === 'left' ? <>{rail}{drawerPanel}{splitter}</> : <>{splitter}{drawerPanel}{rail}</>}</>
}

function isWorkspaceTool(value: string): value is WorkspaceTool {
  return ['archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'tasks', 'plans', 'executions', 'fifo', 'evolution', 'terminal', 'database'].includes(value)
}
function AttentionCenterDrawer({ items, activeChatId, busy, onOpen, onAction, onClose }: { items: AttentionItem[]; activeChatId: string; busy: boolean; onOpen: (item: AttentionItem) => Promise<void>; onAction: (item: AttentionItem) => Promise<void>; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | 'urgent' | 'actionable'>('all')
  const summary = summarizeAttention(items)
  const filteredItems = filter === 'urgent' ? items.filter((item) => item.tone === 'danger') : filter === 'actionable' ? items.filter((item) => Boolean(item.action)) : items
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
    </nav>
    <div className="attention-center-list">
      {filteredItems.length ? <AttentionList items={filteredItems} activeChatId={activeChatId} busy={busy} density="full" onOpen={onOpen} onAction={onAction}/> : <div className="agent-drawer-empty attention-empty"><Icon name="check" size={18}/><strong>{items.length ? 'Nenhum alerta neste filtro' : 'Nada requer atenção'}</strong><span>{items.length ? 'Escolha outro filtro para rever os alertas ativos.' : 'Alertas de todos os chats abertos deste projeto aparecerão aqui.'}</span></div>}
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

function ChatManagementDrawer({ projectPath, savedChats, archivedChats, busy, onRestoreSaved, onArchiveSaved, onRestoreArchived, onDeleteArchived, onRename, onGenerate, onClose }: {
  projectPath: string
  savedChats: ComponentProps<typeof ChatPanel>['archivedChats']
  archivedChats: ComponentProps<typeof ChatPanel>['archivedChats']
  busy: boolean
  onRestoreSaved?: (chatId: string) => Promise<void>
  onArchiveSaved?: (chatId: string) => Promise<void>
  onRestoreArchived: ComponentProps<typeof ChatPanel>['onRestoreChat']
  onDeleteArchived: ComponentProps<typeof ChatPanel>['onDeleteArchivedChat']
  onRename: ComponentProps<typeof ChatPanel>['onRenameChat']
  onGenerate: ComponentProps<typeof ChatPanel>['onGenerateChatTitle']
  onClose: () => void
}) {
  const [tab, setTab] = useState<'saved' | 'archived'>(() => savedChats.length ? 'saved' : 'archived')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<string>()
  const chats = tab === 'saved' ? savedChats : archivedChats
  const normalizedQuery = query.trim().toLowerCase()
  const visible = chats.filter((chat) => chat.title.toLowerCase().includes(normalizedQuery))
  const previewChat = chats.find((chat) => chat.id === preview)
  const previewItems = previewChat ? loadChat(projectPath, previewChat.id) : []
  const visibleLabel = normalizedQuery ? `${visible.length} de ${chats.length}` : `${chats.length} ${chats.length === 1 ? 'chat' : 'chats'}`
  const emptyTitle = chats.length ? 'Nenhum resultado' : tab === 'saved' ? 'Ainda não há chats guardados' : 'Ainda não há chats arquivados'
  const emptyDetail = chats.length ? 'Tente pesquisar por outro título.' : tab === 'saved' ? 'Guardar suspende o chat e deixa as execuções em standby até reativar ou arquivar.' : 'Os chats fechados ficam organizados aqui sem perder o histórico.'
  const setManagementTab = (next: 'saved' | 'archived') => { setTab(next); setQuery(''); setPreview(undefined) }

  return <section className="agent-archive-drawer" aria-label="Gestão de chats">
    <header className="agent-drawer-heading agent-archive-heading"><div><span className="panel-kicker">Workspace</span><div className="agent-archive-heading-row"><strong>Gestão de chats</strong><span className="agent-archive-count">{savedChats.length + archivedChats.length}</span></div></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar Gestão de chats"><Icon name="close" size={13}/></button></header>
    <nav className="agent-chat-management-tabs" role="tablist" aria-label="Estado dos chats">
      <button type="button" role="tab" aria-selected={tab === 'saved'} onClick={() => setManagementTab('saved')}>Guardados <b>{savedChats.length}</b></button>
      <button type="button" role="tab" aria-selected={tab === 'archived'} onClick={() => setManagementTab('archived')}>Arquivados <b>{archivedChats.length}</b></button>
    </nav>
    <div className="agent-archive-toolbar"><label className="panel-search-field archive-search"><Icon name="search" size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'saved' ? 'Pesquisar chats guardados' : 'Pesquisar chats arquivados'}/></label><span className="agent-archive-filter-count" aria-live="polite">{visibleLabel}</span></div>
    <div className="agent-archive-list">
      {visible.length ? visible.map((chat) => {
        const stateAt = tab === 'saved' ? (chat.savedAt || chat.updatedAt) : (chat.archivedAt || chat.updatedAt)
        return <article className="agent-archive-item" key={chat.id} onClick={() => setPreview(chat.id)}>
          <div className="agent-archive-copy">
            <div className="agent-archive-card-title"><strong>{chat.title}</strong><span className={chat.chatgptUrl ? 'agent-archive-link linked' : 'agent-archive-link local'}>{chat.chatgptUrl ? 'ChatGPT' : 'Local'}</span></div>
            <div className="agent-archive-meta"><span><small>Início</small><time dateTime={chat.createdAt}>{new Date(chat.createdAt).toLocaleString()}</time></span><span><small>{tab === 'saved' ? 'Guardado' : 'Encerramento'}</small><time dateTime={stateAt}>{new Date(stateAt).toLocaleString()}</time></span></div>
          </div>
          <div className="agent-archive-actions">
            <button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); void promptDialog({ title: 'Renomear chat', inputLabel: 'Novo nome', initialValue: chat.title, confirmLabel: 'Renomear' }).then((title) => { if (title) return onRename?.(chat.id, title) }) }} aria-label={`Renomear ${chat.title}`} title="Renomear"><Icon name="rename" size={13}/></button>
            {tab === 'archived' && <button type="button" disabled={busy || !chat.chatgptUrl} onClick={(event) => { event.stopPropagation(); void onGenerate?.(chat.id) }} aria-label={`Gerar nome para ${chat.title}`} title="Usar o título contextual gerado pelo ChatGPT"><Icon name="agent" size={13}/></button>}
            {tab === 'saved' ? <><button type="button" disabled={busy || !onRestoreSaved} onClick={(event) => { event.stopPropagation(); void onRestoreSaved?.(chat.id) }} aria-label={`Reativar ${chat.title}`} title="Reativar"><Icon name="refresh" size={13}/></button><button type="button" disabled={busy || !onArchiveSaved} onClick={(event) => { event.stopPropagation(); void onArchiveSaved?.(chat.id) }} aria-label={`Arquivar ${chat.title}`} title="Arquivar"><Icon name="archive" size={13}/></button></> : <button type="button" className="danger" disabled={busy} onClick={(event) => { event.stopPropagation(); void onDeleteArchived(chat.id) }} aria-label={`Eliminar definitivamente ${chat.title}`} title="Eliminar definitivamente"><Icon name="trash" size={13}/></button>}
          </div>
        </article>
      }) : <div className="agent-archive-empty"><span className="agent-archive-empty-icon"><Icon name="folder" size={18}/></span><strong>{emptyTitle}</strong><p>{emptyDetail}</p></div>}
    </div>
    {previewChat && <div className="archived-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(undefined) }}><section className="archived-preview" role="dialog" aria-modal="true" aria-label={`Pré-visualização de ${previewChat.title}`}><header><div><span className="panel-kicker">{tab === 'saved' ? 'Em standby' : 'Somente leitura'}</span><h2>{previewChat.title}</h2><p>{new Date(previewChat.createdAt).toLocaleString()} — {new Date(tab === 'saved' ? (previewChat.savedAt || previewChat.updatedAt) : (previewChat.archivedAt || previewChat.updatedAt)).toLocaleString()}</p></div><button className="icon-button light" onClick={() => setPreview(undefined)} aria-label="Fechar pré-visualização"><Icon name="close" size={14}/></button></header><div className="archived-preview-stream">{previewItems.map((item) => <article key={item.id} className={`archived-preview-message ${item.source || item.role}`}><small>{item.source === 'chatgpt' ? 'ChatGPT' : item.source === 'wharness' ? 'WHX' : 'Você'} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small><MarkdownContent markdown={item.text}/></article>)}</div>{tab === 'saved' ? <footer><span>Execuções e automação estão em standby. A conversa remota permanece intacta.</span><div className="agent-chat-management-preview-actions"><button className="secondary-button" disabled={busy || !onArchiveSaved} onClick={() => void onArchiveSaved?.(previewChat.id)}><Icon name="archive" size={13}/> Arquivar</button><button className="apply-button" disabled={busy || !onRestoreSaved} onClick={() => void onRestoreSaved?.(previewChat.id)}><Icon name="refresh" size={13}/> Reativar chat</button></div></footer> : <footer><span>Envio e processamento permanecem bloqueados até restaurar.</span><button className="apply-button" disabled={busy} onClick={() => void onRestoreArchived(previewChat.id)}><Icon name="refresh" size={13}/> Restaurar chat</button></footer>}</section></div>}
  </section>
}

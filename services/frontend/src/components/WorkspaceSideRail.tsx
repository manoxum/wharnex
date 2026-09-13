import { useEffect, useState, type ComponentProps } from 'react'
import type { HarnessEvent, Session } from '../types'
import { ChatPanel } from './ChatPanel'
import { promptDialog } from '../lib/appDialog'
import { Icon } from './Icon'
import { AgentProjectExplorer } from './AgentProjectExplorer'
import { ProjectActivityDrawer, type ProjectActivityKind } from './ProjectActivityDrawer'
import { EvolutionEvidenceDrawer } from './EvolutionEvidenceDrawer'
import { ProjectKnowledgeDrawer } from './ProjectKnowledgeDrawer'
import { GitDrawer } from './GitDrawer'
import { AgentRuntimeDrawer } from './AgentRuntimeDrawer'
import { ChatAgentTasksDrawer } from './ChatAgentTasksDrawer'
import { FilePreviewModal } from './FilePreviewModal'
import { MarkdownContent } from './MarkdownContent'
import { loadChat } from '../lib/workspaceMemory'
import { desktopWindowScope } from '../lib/projectBindings'
import { api } from '../lib/api'
import { summarizeAttention, type AttentionItem } from '../lib/attentionCenter'
import type { ExecutionFIFOItem } from '../lib/executionQueueView'
import { AttentionList } from './AttentionList'

// The workspace side rail is shell-level, not Agent-level: one rail and one
// drawer sit beside every mode surface, so switching between Agent, Editor and
// Orchestrator never changes which panel is open or how wide it is. Rendering
// it once is also what keeps the polling drawers (runtime, Git) from being
// mounted three times over, which is what a per-mode copy would cost.
export type Drawer = 'attention' | 'archive' | 'project' | 'knowledge' | 'git' | 'agents' | 'tasks' | 'fifo' | 'evolution' | ProjectActivityKind | ''

const WORKSPACE_DRAWER_WIDTH_KEY = 'whx.workspace.drawer-width'
const WORKSPACE_RAIL_PX = 42
const WORKSPACE_SPLITTER_PX = 6
const WORKSPACE_DRAWER_MIN_PX = 240
const WORKSPACE_STACK_MIN_PX = 560

function scopedKey(prefix: string) { return `${prefix}:${desktopWindowScope()}` }

function loadWorkspaceDrawerWidth() {
  try { return Number(localStorage.getItem(scopedKey(WORKSPACE_DRAWER_WIDTH_KEY))) || 0 } catch { return 0 }
}

function saveWorkspaceDrawerWidth(width: number) {
  try { localStorage.setItem(scopedKey(WORKSPACE_DRAWER_WIDTH_KEY), String(width)) } catch { /* best effort */ }
}

export type WorkspaceSideRailProps = {
  session: Session
  busy: boolean
  drawer: Drawer
  onDrawer: (next: Drawer) => void
  chats: ComponentProps<typeof ChatPanel>['chats']
  archivedChats: ComponentProps<typeof ChatPanel>['archivedChats']
  activeChatId: string
  activeEvents: HarnessEvent[]
  attentionItems: AttentionItem[]
  executionFIFO: ExecutionFIFOItem[]
  activeExecutionCount: number
  onOpenAttention: (item: AttentionItem) => Promise<void>
  onAttentionAction: (item: AttentionItem) => Promise<void>
  onRestoreChat: ComponentProps<typeof ChatPanel>['onRestoreChat']
  onDeleteArchivedChat: ComponentProps<typeof ChatPanel>['onDeleteArchivedChat']
  onRenameChat: ComponentProps<typeof ChatPanel>['onRenameChat']
  onGenerateChatTitle: ComponentProps<typeof ChatPanel>['onGenerateChatTitle']
  onOpenFile: (path: string) => void
  onAnalyzeEvolution?: (ids: string[]) => Promise<void>
  onError: (message: string) => void
  terminalOpen: boolean
  onToggleTerminal: () => void
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onGoToOrchestrator?: () => void
  onFollowInstance?: (agentId: string, chatId?: string, sessionId?: string) => void
}

/**
 * The activity rail, the open drawer and the drawer's own resize splitter.
 *
 * The drawer closes only through its own close control or by toggling the same
 * rail button: no event — attention routing, following a Worker, switching
 * workspace mode — dismisses it, because the operator loses their place when a
 * panel they were reading disappears underneath them.
 */
export function WorkspaceSideRail(props: WorkspaceSideRailProps) {
  const { session, busy, drawer, onDrawer, archivedChats, attentionItems, executionFIFO, activeExecutionCount, onError } = props
  const [previewPath, setPreviewPath] = useState<string>()
  const [drawerWidth, setDrawerWidth] = useState(loadWorkspaceDrawerWidth)
  const [pendingCommitCount, setPendingCommitCount] = useState(0)

  // The badge exists so uncommitted Wharnex work is visible without opening the
  // panel. It refetches only when an Apply could have created a record, never
  // on a timer: a poll would make an idle workspace talk to the backend forever
  // to learn a number that only changes when the user applies something.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const overview = await api.gitOverview(session.id)
        if (!cancelled) setPendingCommitCount(overview.pending.length)
      } catch {
        if (!cancelled) setPendingCommitCount(0)
      }
    })()
    return () => { cancelled = true }
  }, [session.id, session.last_host_applied_at, drawer])

  const toggle = (next: Exclude<Drawer, ''>) => onDrawer(drawer === next ? '' : next)
  const close = () => onDrawer('')

  function beginDrawerResize(event: React.PointerEvent<HTMLButtonElement>) {
    const body = event.currentTarget.closest('.workspace-body') as HTMLElement | null
    if (!body) return
    const rect = body.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    const update = (clientX: number) => {
      // Whatever the drawer takes must leave the mode surface a usable width.
      const ceiling = Math.max(WORKSPACE_DRAWER_MIN_PX, rect.width - WORKSPACE_RAIL_PX - WORKSPACE_SPLITTER_PX - WORKSPACE_STACK_MIN_PX)
      const next = Math.round(Math.max(WORKSPACE_DRAWER_MIN_PX, Math.min(ceiling, clientX - rect.left - WORKSPACE_RAIL_PX)))
      setDrawerWidth(next); saveWorkspaceDrawerWidth(next)
    }
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX)
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish)
  }

  return <>
    <aside className="agent-activity-bar" aria-label="Ferramentas do workspace">
      <button type="button" className={drawer === 'archive' ? 'active' : ''} onClick={() => toggle('archive')} aria-label="Chats arquivados" title="Chats arquivados"><Icon name="folder" size={18}/>{archivedChats.length > 0 && <b>{archivedChats.length}</b>}</button>
      <button type="button" className={drawer === 'project' ? 'active' : ''} onClick={() => toggle('project')} aria-label="Explorador do projeto" title="Explorador do projeto"><Icon name="workspace" size={18}/></button>
      <button type="button" className={drawer === 'knowledge' ? 'active' : ''} onClick={() => toggle('knowledge')} aria-label="Conhecimento do projeto" title="Conhecimento adquirido"><Icon name="clipboard" size={18}/></button>
      <button type="button" className={drawer === 'git' ? 'active' : ''} onClick={() => toggle('git')} aria-label="Git do projeto" title="Git do projeto"><Icon name="git" size={18}/>{pendingCommitCount > 0 && <b>{pendingCommitCount}</b>}</button>
      <button type="button" className={drawer === 'agents' ? 'active' : ''} onClick={() => toggle('agents')} aria-label="Gestão de agentes" title="Supervisor e Workers"><Icon name="agent" size={18}/></button>
      <button type="button" className={drawer === 'tasks' ? 'active' : ''} onClick={() => toggle('tasks')} aria-label="Tarefas do runtime" title="Fila e tarefas em execução"><Icon name="list" size={18}/></button>
      <button type="button" className={drawer === 'plans' ? 'active' : ''} onClick={() => toggle('plans')} aria-label="Planos do projeto" title="Planos do projeto"><Icon name="plan" size={18}/></button>
      <button type="button" className={drawer === 'executions' ? 'active' : ''} onClick={() => toggle('executions')} aria-label="Execuções do projeto" title="Execuções do projeto"><Icon name="terminal" size={18}/></button>
      <button type="button" className={drawer === 'fifo' ? 'active' : ''} onClick={() => toggle('fifo')} aria-label="Fila FIFO de execução" title="Fila FIFO de execução"><Icon name="play" size={18}/>{activeExecutionCount > 0 && <b>{activeExecutionCount}</b>}</button>
      {session.self_evolution && <button type="button" className={drawer === 'evolution' ? 'active' : ''} onClick={() => toggle('evolution')} aria-label="Logs de auto-evolução" title="Logs e análise de auto-evolução"><Icon name="refresh" size={18}/></button>}
      {/* The terminal is the project's, not the Editor's, so it is reachable
          from every mode — collapsed by default so it costs no height until
          the operator asks for it. */}
      <button type="button" className={`workspace-rail-terminal ${props.terminalOpen ? 'active' : ''}`} onClick={props.onToggleTerminal} aria-pressed={props.terminalOpen} aria-label={props.terminalOpen ? 'Fechar terminal' : 'Abrir terminal'} title={props.terminalOpen ? 'Fechar terminal' : 'Abrir terminal do projeto'}><Icon name="terminal" size={18}/></button>
    </aside>

    {/* No per-drawer width class: every drawer opens at the same width, and the
        operator resizes it from the splitter that follows. */}
    {drawer && <aside className="agent-drawer" style={drawerWidth ? { ['--workspace-drawer-width' as string]: `${drawerWidth}px` } as React.CSSProperties : undefined}>
      {drawer === 'attention' ? <AttentionCenterDrawer items={attentionItems} activeChatId={props.activeChatId} busy={busy} onOpen={props.onOpenAttention} onAction={props.onAttentionAction} onClose={close}/> : null}
      {drawer === 'archive' ? <ArchiveDrawer projectPath={session.project_path} chats={archivedChats} busy={busy} onRestore={props.onRestoreChat} onDelete={props.onDeleteArchivedChat} onRename={props.onRenameChat} onGenerate={props.onGenerateChatTitle} onClose={close}/> : null}
      {drawer === 'project' ? <AgentProjectExplorer session={session} onOpen={setPreviewPath} onError={onError} onClose={close}/> : null}
      {drawer === 'knowledge' ? <ProjectKnowledgeDrawer session={session} onClose={close}/> : null}
      {drawer === 'git' ? <GitDrawer session={session} busy={busy} onClose={close} onError={onError}/> : null}
      {drawer === 'agents' ? <AgentRuntimeDrawer projectPath={session.project_path} onClose={close} onError={onError}/> : null}
      {drawer === 'tasks' ? <ChatAgentTasksDrawer projectPath={session.project_path} onClose={close} onError={onError} chats={props.chats} onGoToChat={props.onGoToChat} onGoToOrchestrator={props.onGoToOrchestrator} onFollowInstance={props.onFollowInstance}/> : null}
      {drawer === 'plans' || drawer === 'executions' ? <ProjectActivityDrawer kind={drawer} chats={[...props.chats, ...archivedChats]} currentSession={session} activeChatId={props.activeChatId} activeEvents={props.activeEvents} onClose={close}/> : null}
      {drawer === 'fifo' ? <ExecutionQueueDrawer items={executionFIFO} onClose={close} onError={onError}/> : null}
      {drawer === 'evolution' && session.self_evolution ? <EvolutionEvidenceDrawer session={session} busy={busy} onAnalyze={props.onAnalyzeEvolution || (async () => undefined)} onClose={close}/> : null}
    </aside>}
    {drawer && <button type="button" className="agent-drawer-splitter" aria-label="Redimensionar painel lateral" title="Arraste para redimensionar" onPointerDown={beginDrawerResize}/>}

    {previewPath && <FilePreviewModal sessionId={session.id} path={previewPath} onOpenInEditor={props.onOpenFile} onClose={() => setPreviewPath(undefined)}/>}
  </>
}

function AttentionCenterDrawer({ items, activeChatId, busy, onOpen, onAction, onClose }: { items: AttentionItem[]; activeChatId: string; busy: boolean; onOpen: (item: AttentionItem) => Promise<void>; onAction: (item: AttentionItem) => Promise<void>; onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | 'urgent' | 'actionable'>('all')
  const summary = summarizeAttention(items)
  const filteredItems = filter === 'urgent' ? items.filter((item) => item.tone === 'danger') : filter === 'actionable' ? items.filter((item) => Boolean(item.action)) : items
  return <section className="attention-center-drawer" aria-label="Centro de notificações">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Atenção Global</span><strong>Centro de Alertas</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar Centro de Alertas"><Icon name="close" size={13}/></button></header>
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

function ArchiveDrawer({ projectPath, chats, busy, onRestore, onDelete, onRename, onGenerate, onClose }: {
  projectPath: string
  chats: ComponentProps<typeof ChatPanel>['archivedChats']
  busy: boolean
  onRestore: ComponentProps<typeof ChatPanel>['onRestoreChat']
  onDelete: ComponentProps<typeof ChatPanel>['onDeleteArchivedChat']
  onRename: ComponentProps<typeof ChatPanel>['onRenameChat']
  onGenerate: ComponentProps<typeof ChatPanel>['onGenerateChatTitle']
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<string>()
  const visible = chats.filter((chat) => chat.title.toLowerCase().includes(query.toLowerCase()))
  const previewChat = chats.find((chat) => chat.id === preview)
  const previewItems = previewChat ? loadChat(projectPath, previewChat.id) : []
  return <section className="agent-archive-drawer" aria-label="Chats arquivados">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Chats</span><strong>Arquivados</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar drawer"><Icon name="close" size={13}/></button></header>
    <label className="archive-search"><Icon name="search" size={13}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar chats arquivados"/></label>
    <div className="agent-archive-list">
      {visible.length ? visible.map((chat) => <article className="agent-archive-item" key={chat.id} onClick={() => setPreview(chat.id)}>
        <div><strong>{chat.title}</strong><span>Início {new Date(chat.createdAt).toLocaleString()}</span><span>Encerramento {new Date(chat.archivedAt || chat.updatedAt).toLocaleString()}</span></div>
        <div><button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); void promptDialog({ title: 'Renomear chat', inputLabel: 'Novo nome', initialValue: chat.title, confirmLabel: 'Renomear' }).then((title) => { if (title) return onRename?.(chat.id, title) }) }} aria-label={`Renomear ${chat.title}`} title="Renomear"><Icon name="rename" size={13}/></button><button type="button" disabled={busy || !chat.chatgptUrl} onClick={(event) => { event.stopPropagation(); void onGenerate?.(chat.id) }} aria-label={`Gerar nome para ${chat.title}`} title="Usar o título contextual gerado pelo ChatGPT"><Icon name="agent" size={13}/></button><button type="button" className="danger" disabled={busy} onClick={(event) => { event.stopPropagation(); void onDelete(chat.id) }} aria-label={`Eliminar definitivamente ${chat.title}`} title="Eliminar definitivamente"><Icon name="trash" size={13}/></button></div>
      </article>) : <div className="agent-drawer-empty">Nenhum chat arquivado corresponde à pesquisa.</div>}
    </div>
    {previewChat && <div className="archived-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(undefined) }}><section className="archived-preview" role="dialog" aria-modal="true" aria-label={`Pré-visualização de ${previewChat.title}`}><header><div><span className="panel-kicker">Somente leitura</span><h2>{previewChat.title}</h2><p>{new Date(previewChat.createdAt).toLocaleString()} — {new Date(previewChat.archivedAt || previewChat.updatedAt).toLocaleString()}</p></div><button className="icon-button light" onClick={() => setPreview(undefined)} aria-label="Fechar pré-visualização"><Icon name="close" size={14}/></button></header><div className="archived-preview-stream">{previewItems.map((item) => <article key={item.id} className={`archived-preview-message ${item.source || item.role}`}><small>{item.source === 'chatgpt' ? 'ChatGPT' : item.source === 'wharness' ? 'WHX' : 'Você'} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small><MarkdownContent markdown={item.text}/></article>)}</div><footer><span>Envio e processamento permanecem bloqueados até restaurar.</span><button className="apply-button" disabled={busy} onClick={() => void onRestore(previewChat.id)}><Icon name="refresh" size={13}/> Restaurar chat</button></footer></section></div>}
  </section>
}

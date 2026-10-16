import { ExecutionQueue, TaskOverview } from './operations'
import { EmptyState, Button } from '../../presentation/workbench'
import { ProjectTaskTabs } from './ProjectTaskTabs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatAgentTask, HarnessEvent, OrchestratorTaskRun, Session } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import type { ExecutionFIFOItem } from '../../../lib/execution/history/executionQueueView'
import type { WorkspaceChat } from '../../../lib/chat/history/workspaceMemory'
import {
  collectExecutionActivities,
  collectPlanActivities,
  executionAuditEvents,
  executionEventsFromResult,
  groupMainRequestActivity,
  sessionForPlan,
  type ExecutionActivityItem,
  type PlanActivityItem,
} from '../../../lib/project/context/projectActivity'
import { Icon } from '../../presentation/chrome/Icon'
import { ContentSkeleton } from '../../presentation/chrome/Skeleton'
import { PlanView, TerminalView } from '../../editor/inspector/Inspector'
import { ChatAgentTaskTimeline } from '../../chat/tasks/ChatAgentTaskTimeline'
import { ProjectTaskCardShell } from './ProjectTaskCardShell'
import { ProjectTaskListPanel } from './ProjectTaskListPanel'
const ACTIVE = new Set(['PENDING', 'LEASED', 'RUNNING', 'WAITING', 'READY', 'DOING', 'REVIEW'])
const FAILED = new Set(['FAILED', 'ATTENTION'])
const REQUEST_TASK_TYPES = new Set(['AWAIT_RESPONSE', 'BOT_WRITE', 'RECOVERY_WRITE', 'ORCHESTRATOR_PLAN'])
type ProjectTaskTab = 'queue' | 'completed' | 'archived'
type HistoricalProjectTaskTab = Exclude<ProjectTaskTab, 'queue'>

const HISTORY_PAGE_SIZE = 40
type ProjectTaskSource = 'chat' | 'worker' | 'translation' | 'release' | 'todo' | 'orchestrator' | 'system'

type ProjectTask = {
  key: string
  kind: 'request' | 'standalone'
  source: ProjectTaskSource
  title: string
  taskType: string
  rootRequestId: string
  chatId: string
  sessionId: string
  prompt: string
  createdAt: string
  updatedAt: string
  tasks: ChatAgentTask[]
  requests: Array<{ requestId: string; kind: string; status: string; createdAt: string; tasks: ChatAgentTask[] }>
  disposition: ProjectTaskTab
  failed: boolean
  chat?: WorkspaceChat
  session?: Session
}

type DeferredTaskPage = {
  tasks: ChatAgentTask[]
  nextCursor: string
  hasMore: boolean
  loaded: boolean
  loading: boolean
  error: string
}

function emptyDeferredTaskPage(): DeferredTaskPage {
  return { tasks: [], nextCursor: '', hasMore: false, loaded: false, loading: false, error: '' }
}

function emptyHistoryPages(): Record<HistoricalProjectTaskTab, DeferredTaskPage> {
  return { completed: emptyDeferredTaskPage(), archived: emptyDeferredTaskPage() }
}

export function ProjectTasksDrawer({ projectPath, chats, savedChats, archivedChats, currentSession, activeChatId, activeEvents, executionFIFO = [], onClose, onError, onGoToChat }: {
  projectPath: string
  chats: WorkspaceChat[]
  savedChats: WorkspaceChat[]
  archivedChats: WorkspaceChat[]
  currentSession: Session
  activeChatId: string
  activeEvents: HarnessEvent[]
  executionFIFO?: ExecutionFIFOItem[]
  onClose: () => void
  onError?: (message: string) => void
  onGoToChat?: (chatId?: string, sessionId?: string) => void
}) {
  const [activeTasks, setActiveTasks] = useState<ChatAgentTask[]>([])
  const [historyPages, setHistoryPages] = useState<Record<HistoricalProjectTaskTab, DeferredTaskPage>>(emptyHistoryPages)
  const [sessions, setSessions] = useState<Record<string, Session>>({ [currentSession.id]: currentSession })
  const [activeLoading, setActiveLoading] = useState(true)
  const [activeError, setActiveError] = useState('')
  const [tab, setTab] = useState<ProjectTaskTab>('queue')
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | ProjectTaskSource>('all')
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath
  const allChats = useMemo(() => [...chats, ...savedChats, ...archivedChats], [archivedChats, chats, savedChats])
  const rememberSession = useCallback((session: Session) => { setSessions((current) => ({ ...current, [session.id]: session })) }, [])

  useEffect(() => { rememberSession(currentSession) }, [currentSession, rememberSession])
  useEffect(() => {
    setActiveTasks([])
    setHistoryPages(emptyHistoryPages())
    setActiveLoading(true)
    setActiveError('')
    setTab('queue')
  }, [projectPath])

  const loadActiveTasks = useCallback(async (foreground: boolean) => {
    const requestedProject = projectPath
    if (foreground) setActiveLoading(true)
    try {
      const result = await api.projectTasks(projectPath, { scope: 'active' })
      if (projectPathRef.current !== requestedProject) return
      setActiveTasks(Array.isArray(result.tasks) ? result.tasks : [])
      setActiveError('')
    } catch (error) {
      if (projectPathRef.current !== requestedProject) return
      setActiveError(error instanceof Error ? error.message : 'Não foi possível carregar as tarefas em curso.')
    } finally {
      if (foreground && projectPathRef.current === requestedProject) setActiveLoading(false)
    }
  }, [projectPath])

  const loadHistoryPage = useCallback(async (target: HistoricalProjectTaskTab, cursor = '', append = false) => {
    const requestedProject = projectPath
    setHistoryPages((current) => ({ ...current, [target]: { ...current[target], loading: true, error: '' } }))
    try {
      const result = await api.projectTasks(projectPath, { scope: 'history', limit: HISTORY_PAGE_SIZE, cursor })
      if (projectPathRef.current !== requestedProject) return
      const pageTasks = Array.isArray(result.tasks) ? result.tasks : []
      setHistoryPages((current) => ({
        ...current,
        [target]: {
          tasks: append ? mergeTaskPages(current[target].tasks, pageTasks) : pageTasks,
          nextCursor: result.next_cursor || '',
          hasMore: Boolean(result.has_more),
          loaded: true,
          loading: false,
          error: '',
        },
      }))
    } catch (error) {
      if (projectPathRef.current !== requestedProject) return
      setHistoryPages((current) => ({
        ...current,
        [target]: { ...current[target], loading: false, error: error instanceof Error ? error.message : 'Não foi possível carregar o histórico de tarefas.' },
      }))
    }
  }, [projectPath])

  useEffect(() => { void loadActiveTasks(true) }, [loadActiveTasks])

  useEffect(() => {
    const timer = window.setInterval(() => { void loadActiveTasks(false) }, 5000)
    return () => { window.clearInterval(timer) }
  }, [loadActiveTasks])

  useEffect(() => {
    if (tab === 'queue') return
    const page = historyPages[tab]
    if (!page.loaded && !page.loading && !page.error) void loadHistoryPage(tab)
  }, [historyPages, loadHistoryPage, tab])

  const queueTasks = useMemo(() => buildProjectTasks(activeTasks, allChats, sessions).filter((item) => item.disposition === 'queue'), [activeTasks, allChats, sessions])
  const completedTasks = useMemo(() => buildProjectTasks(historyPages.completed.tasks, allChats, sessions).filter((item) => item.disposition === 'completed'), [allChats, historyPages.completed.tasks, sessions])
  const archivedTaskItems = useMemo(() => buildProjectTasks(historyPages.archived.tasks, allChats, sessions).filter((item) => item.disposition === 'archived'), [allChats, historyPages.archived.tasks, sessions])
  const tasksByTab = useMemo<Record<ProjectTaskTab, ProjectTask[]>>(() => ({ queue: queueTasks, completed: completedTasks, archived: archivedTaskItems }), [archivedTaskItems, completedTasks, queueTasks])
  const counts = { queue: queueTasks.length, completed: completedTasks.length, archived: archivedTaskItems.length }
  const attentionCount = useMemo(() => queueTasks.filter((item) => item.failed).length, [queueTasks])
  const runningCount = useMemo(() => executionFIFO.filter((item) => item.status === 'running' || item.status === 'submitting').length, [executionFIFO])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visible = useMemo(() => tasksByTab[tab].filter((item) => {
    if (sourceFilter !== 'all' && item.source !== sourceFilter) return false
    if (!normalizedQuery) return true
    return [item.title, item.prompt, item.rootRequestId, item.taskType, sourceLabel(item.source)].some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  }), [normalizedQuery, sourceFilter, tab, tasksByTab])
  const filtering = Boolean(normalizedQuery || sourceFilter !== 'all')
  const historyPage = tab === 'queue' ? undefined : historyPages[tab]
  const initialLoading = tab === 'queue' ? activeLoading && !queueTasks.length : Boolean(historyPage?.loading && !historyPage.loaded)
  const pageLoading = tab === 'queue' ? activeLoading && Boolean(queueTasks.length) : Boolean(historyPage?.loading && historyPage.loaded)
  const panelError = tab === 'queue' ? activeError : historyPage?.error || ''

  const retryHistory = (target: HistoricalProjectTaskTab) => {
    const page = historyPages[target]
    void loadHistoryPage(target, page.loaded ? page.nextCursor : '', page.loaded)
  }

  return <section className="project-tasks-drawer !flex !min-h-0 !flex-1 !flex-col !overflow-hidden !bg-whx-bg" aria-label="Tarefas do projeto">
    <TaskOverview counts={counts} runningCount={runningCount} attentionCount={attentionCount} query={query} source={sourceFilter} onQuery={setQuery} onSource={(value) => setSourceFilter(value as typeof sourceFilter)} onClose={onClose}/>
    <ProjectTaskTabs value={tab} onChange={setTab} counts={counts}/>
    <ProjectTaskListPanel>
      {tab === 'queue' ? <ExecutionQueue items={executionFIFO} onError={onError}/> : null}
      {initialLoading ? <ContentSkeleton label={tab === 'queue' ? 'A carregar tarefas em curso' : `A carregar tarefas ${tab === 'completed' ? 'concluídas' : 'arquivadas'}`} rows={6}/> : visible.map((item) => <ProjectTaskCard key={item.key} item={item} currentSession={currentSession} activeChatId={activeChatId} activeEvents={activeEvents} onSessionLoaded={rememberSession} onGoToChat={onGoToChat}/>)}
      {!initialLoading && !visible.length && !panelError ? <EmptyState icon={filtering ? 'search' : 'list'} title={filtering ? 'Nenhuma tarefa corresponde ao filtro nos itens carregados.' : historyPage?.hasMore ? `Ainda não há tarefas ${tab === 'completed' ? 'concluídas' : 'arquivadas'} nesta página.` : emptyTitle(tab)} description={filtering ? 'Altere a pesquisa ou a origem, ou carregue mais histórico quando disponível.' : historyPage?.hasMore ? 'Carregue a próxima página para continuar a procurar sem perder os itens já obtidos.' : emptyDetail(tab)} action={filtering ? <Button onClick={() => { setQuery(''); setSourceFilter('all') }}>Limpar filtros</Button> : onGoToChat ? <Button icon="chatgpt" onClick={() => onGoToChat(activeChatId, currentSession.id)}>Ir para a conversa</Button> : undefined}/> : null}
      {panelError ? <EmptyState icon="alert" title="Não foi possível atualizar esta vista." description={panelError} action={<Button icon="refresh" disabled={pageLoading} onClick={() => tab === 'queue' ? void loadActiveTasks(true) : retryHistory(tab)}>Tentar novamente</Button>}/> : null}
      {pageLoading ? <ContentSkeleton label="A carregar mais tarefas" rows={2} compact/> : null}
      {historyPage?.hasMore && !historyPage.loading ? <div className="agent-drawer-empty"><button type="button" className="secondary-button" onClick={() => void loadHistoryPage(tab as HistoricalProjectTaskTab, historyPage.nextCursor, true)}><Icon name="refresh" size={12}/> Carregar mais {tab === 'completed' ? 'concluídas' : 'arquivadas'}</button></div> : null}
    </ProjectTaskListPanel>
  </section>
}

function ProjectTaskCard({ item, currentSession, activeChatId, activeEvents, onSessionLoaded, onGoToChat }: { item: ProjectTask; currentSession: Session; activeChatId: string; activeEvents: HarnessEvent[]; onSessionLoaded: (session: Session) => void; onGoToChat?: (chatId?: string, sessionId?: string) => void }) {
  return <ProjectTaskCardShell disposition={item.disposition} failed={item.failed} source={item.source} sourceLabel={sourceLabel(item.source)} sourceIcon={sourceIcon(item.source)} stateLabel={projectTaskState(item)} title={item.title} updatedAt={item.updatedAt} updatedLabel={formatDate(item.updatedAt)} prompt={presentationPrompt(item.prompt) || standaloneFallback(item)} rootRequestId={item.rootRequestId}
    metadata={<>{item.kind === 'request' ? <span>{item.requests.length} {item.requests.length === 1 ? 'requisição GPT' : 'requisições GPT'}</span> : <span>{taskTypeLabel(item.taskType)}</span>}{item.tasks[0]?.assigned_worker ? <span>Worker: {item.tasks[0].assigned_worker}</span> : null}{item.failed ? <span className="danger">Requer atenção</span> : null}</>} onGoToChat={onGoToChat && item.chatId ? () => onGoToChat(item.chatId, item.sessionId) : undefined}
    renderDetails={() => <ProjectTaskDetail item={item} currentSession={currentSession} activeChatId={activeChatId} activeEvents={activeEvents} onSessionLoaded={onSessionLoaded}/>}/>
}

function ProjectTaskDetail({ item, currentSession, activeChatId, activeEvents, onSessionLoaded }: { item: ProjectTask; currentSession: Session; activeChatId: string; activeEvents: HarnessEvent[]; onSessionLoaded: (session: Session) => void }) {
  return item.kind === 'standalone' ? <StandaloneTaskDetail item={item} currentSession={currentSession}/> : <RequestTaskDetail item={item} currentSession={currentSession} activeChatId={activeChatId} activeEvents={activeEvents} onSessionLoaded={onSessionLoaded}/>
}

function RequestTaskDetail({ item, currentSession, activeChatId, activeEvents, onSessionLoaded }: { item: ProjectTask; currentSession: Session; activeChatId: string; activeEvents: HarnessEvent[]; onSessionLoaded: (session: Session) => void }) {
  const initialSession = item.session || (item.sessionId === currentSession.id ? currentSession : undefined)
  const [loadedSession, setLoadedSession] = useState<Session | undefined>(initialSession)
  const [sessionLoading, setSessionLoading] = useState(Boolean(item.sessionId && !initialSession))
  const [sessionError, setSessionError] = useState('')
  const [history, setHistory] = useState<HarnessEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const session = initialSession || loadedSession

  useEffect(() => {
    let cancelled = false
    if (initialSession) { setLoadedSession(initialSession); setSessionLoading(false); setSessionError(''); return () => { cancelled = true } }
    if (!item.sessionId) { setSessionLoading(false); return () => { cancelled = true } }
    setSessionLoading(true); setSessionError('')
    void api.getSession(item.sessionId).then((value) => {
      if (cancelled) return
      setLoadedSession(value)
      onSessionLoaded(value)
    }).catch((error) => { if (!cancelled) setSessionError(error instanceof Error ? error.message : 'Não foi possível carregar a sessão desta tarefa.') })
      .finally(() => { if (!cancelled) setSessionLoading(false) })
    return () => { cancelled = true }
  }, [initialSession, item.sessionId, onSessionLoaded])

  useEffect(() => {
    let cancelled = false
    if (!item.sessionId) { setLoading(false); return }
    setLoading(true); setHistoryError('')
    void api.eventHistory(item.sessionId, true).then((result) => {
      if (cancelled) return
      const merged = item.chatId === activeChatId && item.sessionId === currentSession.id ? mergeEvents(result.events || [], activeEvents) : (result.events || [])
      setHistory(merged)
    }).catch((error) => { if (!cancelled) setHistoryError(error instanceof Error ? error.message : 'Não foi possível carregar o histórico da tarefa.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeChatId, activeEvents, currentSession.id, item.chatId, item.sessionId])

  const chat = item.chat || syntheticChat(item)
  const plans = useMemo(() => !session ? [] : collectPlanActivities([{ chat, session }], { [chat.id]: history }).filter((candidate) => rootForRequest(session, candidate.plan.request_id) === item.rootRequestId), [chat, history, item.rootRequestId, session])
  const executions = useMemo(() => !session ? [] : collectExecutionActivities([{ chat, session }], { [chat.id]: history }).filter((candidate) => rootForRequest(session, candidate.requestId) === item.rootRequestId || eventMatchesRoot(history, candidate.execution.plan_id, item.rootRequestId, session)), [chat, history, item.rootRequestId, session])
  const rootEvents = useMemo(() => !session ? [] : groupMainRequestActivity(session, history).find((group) => group.rootRequestId === item.rootRequestId)?.events || [], [history, item.rootRequestId, session])
  const anchorTask = item.tasks.find((task) => task.type === 'AWAIT_RESPONSE' && (task.root_request_id || task.request_id) === item.rootRequestId) || item.tasks.find((task) => task.type === 'AWAIT_RESPONSE')

  return <div className="project-task-detail-grid">
    {sessionLoading ? <section><ContentSkeleton label="A carregar contexto da sessão" rows={2} compact/></section> : sessionError ? <section><header><Icon name="alert" size={12}/><strong>Contexto da sessão indisponível</strong></header><p className="project-task-empty-detail danger">{sessionError}</p></section> : null}
    <section><header><Icon name="chatgpt" size={12}/><strong>Subtarefas GPT</strong><span>{item.requests.length}</span></header><div className="project-task-request-list">{item.requests.map((request) => <div key={request.requestId}><div><b>{request.requestId === item.rootRequestId ? 'Principal' : requestKindLabel(request.kind)}</b><code>{request.requestId}</code></div><span className={`request-state ${request.status.toLowerCase()}`}>{requestStatusLabel(request.status)}</span><small>{request.tasks.length} {request.tasks.length === 1 ? 'etapa de transporte' : 'etapas de transporte'} · {formatDate(request.createdAt)}</small></div>)}</div></section>
    <section><header><Icon name="plan" size={12}/><strong>Planos e subplanos</strong><span>{plans.length}</span></header>{plans.length ? <div className="project-task-plan-list">{plans.map((plan) => <PlanHistory key={plan.id} item={plan}/>)}</div> : <p className="project-task-empty-detail">Nenhum plano foi registado para esta Main Request.</p>}</section>
    <section><header><Icon name="history" size={12}/><strong>Execuções e subexecuções</strong><span>{executions.length}</span></header>{executions.length ? <div className="project-task-execution-list">{executions.map((execution) => <ExecutionHistory key={execution.id} item={execution} events={history}/>)}</div> : <p className="project-task-empty-detail">Nenhuma execução foi registada para esta Main Request.</p>}</section>
    <section><header><Icon name="history" size={12}/><strong>Processamento e logs</strong><span>{rootEvents.length}</span></header>{loading ? <ContentSkeleton label="A carregar audit log" rows={4} compact/> : historyError ? <p className="project-task-empty-detail danger">{historyError}</p> : rootEvents.length && session ? <div className="project-task-terminal"><TerminalView session={session} events={rootEvents}/></div> : <p className="project-task-empty-detail">Sem eventos de auditoria correlacionados.</p>}</section>
    {anchorTask ? <section><header><Icon name="agent" size={12}/><strong>Transporte ChatGPT</strong></header><ChatAgentTaskTimeline taskId={anchorTask.task_id} enabled/></section> : null}
  </div>
}

function StandaloneTaskDetail({ item, currentSession }: { item: ProjectTask; currentSession: Session }) {
  const task = item.tasks[0]
  const payload = objectValue(task?.payload)
  const [runs, setRuns] = useState<OrchestratorTaskRun[]>([])
  const isOrchestrator = item.source === 'orchestrator'
  useEffect(() => {
    let active = true
    if (!isOrchestrator || !task?.task_id) return () => { active = false }
    void api.orchestratorTaskRuns(item.sessionId || currentSession.id, task.task_id).then((value) => { if (active) setRuns(value.runs || []) }).catch(() => undefined)
    return () => { active = false }
  }, [currentSession.id, isOrchestrator, item.sessionId, task?.task_id, task?.updated_at])
  const dependencies = stringList(payload.depends_on)
  const criteria = stringList(payload.acceptance_criteria)
  return <div className="project-task-detail-grid">
    <section><header><Icon name="info" size={12}/><strong>Metadados</strong></header><dl className="project-task-metadata"><Meta label="Origem" value={sourceLabel(item.source)}/><Meta label="Tipo" value={taskTypeLabel(item.taskType)}/><Meta label="Estado" value={task?.status}/><Meta label="Prioridade" value={String(task?.priority ?? '—')}/><Meta label="Tentativa" value={`${task?.attempt ?? 0}/${task?.max_attempts ?? 0}`}/><Meta label="Worker" value={task?.assigned_worker || '—'}/><Meta label="Plano" value={task?.plan_id || String(payload.plan_id || '—')}/><Meta label="Condição" value={task?.condition || String(payload.condition || '—')}/></dl></section>
    {dependencies.length || criteria.length ? <section><header><Icon name="plan" size={12}/><strong>Plano e dependências</strong></header>{dependencies.length ? <div className="project-task-detail-copy"><b>Dependências</b><p>{dependencies.join(', ')}</p></div> : null}{criteria.length ? <div className="project-task-detail-copy"><b>Critérios de conclusão</b><ul>{criteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div> : null}</section> : null}
    {isOrchestrator ? <section><header><Icon name="history" size={12}/><strong>Execuções e subexecuções</strong><span>{runs.length}</span></header>{runs.length ? <div className="project-task-run-list">{runs.map((run) => <div key={run.id} className={run.error ? 'failed' : ''}><span>#{run.attempt}</span><div><strong>{run.status}</strong><small>{formatDate(run.started_at)}{run.execution_plan_id ? ` · ${run.execution_plan_id}` : ''}</small>{run.error ? <p>{run.error}</p> : null}</div></div>)}</div> : <p className="project-task-empty-detail">Nenhuma execução registada.</p>}</section> : null}
    {task?.last_error ? <section className="project-task-error-detail"><header><Icon name="alert" size={12}/><strong>Último erro</strong></header><p>{task.last_error}</p></section> : null}
    <section><header><Icon name="code" size={12}/><strong>Payload durável</strong></header><pre className="project-task-payload">{JSON.stringify(task?.payload ?? {}, null, 2)}</pre></section>
    {task?.task_id && item.source !== 'orchestrator' ? <section><header><Icon name="agent" size={12}/><strong>Eventos da tarefa</strong></header><ChatAgentTaskTimeline taskId={task.task_id} enabled/></section> : null}
  </div>
}

function Meta({ label, value }: { label: string; value: string | undefined }) { return <div><dt>{label}</dt><dd>{value || '—'}</dd></div> }

function PlanHistory({ item }: { item: PlanActivityItem }) {
  return <details><summary><span><b>{item.plan.summary || item.plan.plan_id}</b><small>{item.label} · {formatDate(item.timestamp)}</small></span><code>{item.plan.plan_id}</code></summary><div className="project-task-plan-view"><PlanView session={sessionForPlan(item)} readOnly/></div></details>
}

function ExecutionHistory({ item, events }: { item: ExecutionActivityItem; events: HarnessEvent[] }) {
  const audit = executionAuditEvents(events, item)
  const visible = audit.length ? audit : executionEventsFromResult(item.execution, item.session.id)
  return <details><summary><span><b>{item.execution.success ? 'Execução concluída' : 'Execução com falha'}</b><small>{formatDate(item.timestamp)} · {item.execution.commands.length} comandos</small></span><code>{item.execution.plan_id}</code></summary><div className="project-task-terminal"><TerminalView session={item.session} events={visible}/></div></details>
}

function buildProjectTasks(tasks: ChatAgentTask[], chats: WorkspaceChat[], sessions: Record<string, Session>): ProjectTask[] {
  const chatByID = new Map(chats.map((chat) => [chat.id, chat]))
  const archived = new Set(chats.filter((chat) => Boolean(chat.archivedAt)).map((chat) => chat.id))
  const groups = new Map<string, ChatAgentTask[]>()
  const consumed = new Set<string>()
  for (const task of tasks) {
    if (!REQUEST_TASK_TYPES.has(task.type) || !task.request_id) continue
    const session = sessions[task.session_id]
    const root = session?.request_lineages?.[task.request_id]?.root_request_id || task.root_request_id || task.request_id
    const key = `${task.chat_id || task.session_id}:${root}`
    const bucket = groups.get(key) || []
    bucket.push(task); groups.set(key, bucket); consumed.add(task.task_id)
  }
  const result: ProjectTask[] = []
  for (const [key, bucket] of groups) {
    bucket.sort((a, b) => a.created_at.localeCompare(b.created_at))
    const first = bucket[0]
    const session = sessions[first.session_id]
    const rootRequestId = session?.request_lineages?.[first.request_id]?.root_request_id || first.root_request_id || first.request_id
    const requests = groupRequests(bucket, session, rootRequestId)
    const active = bucket.some((task) => ACTIVE.has(task.status))
    const failed = bucket.some((task) => FAILED.has(task.status))
    const disposition: ProjectTaskTab = active || failed ? 'queue' : archived.has(first.chat_id) ? 'archived' : 'completed'
    result.push({
      key, kind: 'request', source: 'chat', title: chatByID.get(first.chat_id)?.title || first.title || 'Main Request', taskType: 'MAIN_REQUEST', rootRequestId, chatId: first.chat_id, sessionId: first.session_id,
      prompt: mainPrompt(bucket), createdAt: first.created_at, updatedAt: bucket.reduce((latest, task) => task.updated_at > latest ? task.updated_at : latest, first.updated_at),
      tasks: bucket, requests, disposition, failed, chat: chatByID.get(first.chat_id), session,
    })
  }
  for (const task of tasks) {
    if (consumed.has(task.task_id)) continue
    const source = normalizeTaskSource(task)
    const failed = FAILED.has(task.status) || task.condition === 'failed_run'
    const disposition: ProjectTaskTab = ACTIVE.has(task.status) || failed ? 'queue' : task.status === 'ARCHIVED' || archived.has(task.chat_id) ? 'archived' : 'completed'
    const payload = objectValue(task.payload)
    result.push({
      key: `task:${task.task_id}`, kind: 'standalone', source, title: task.title || taskTypeLabel(task.type), taskType: task.type,
      rootRequestId: task.root_request_id || task.request_id || task.task_id, chatId: task.chat_id, sessionId: task.session_id,
      prompt: task.description || firstText(payload.description, payload.objective, payload.prompt, payload.original_prompt), createdAt: task.created_at, updatedAt: task.updated_at,
      tasks: [task], requests: task.request_id ? groupRequests([task], sessions[task.session_id], task.root_request_id || task.request_id) : [], disposition, failed,
      chat: chatByID.get(task.chat_id), session: sessions[task.session_id],
    })
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function groupRequests(tasks: ChatAgentTask[], session: Session | undefined, rootRequestId: string): ProjectTask['requests'] {
  const groups = new Map<string, ChatAgentTask[]>()
  for (const task of tasks) {
    if (!task.request_id) continue
    const bucket = groups.get(task.request_id) || []
    bucket.push(task); groups.set(task.request_id, bucket)
  }
  return [...groups].map(([requestId, bucket]) => ({ requestId, kind: requestId === rootRequestId ? 'standard' : session?.request_lineages?.[requestId]?.kind || 'continuation', status: requestAggregateStatus(bucket), createdAt: bucket.reduce((earliest, task) => task.created_at < earliest ? task.created_at : earliest, bucket[0].created_at), tasks: bucket })).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function requestAggregateStatus(tasks: ChatAgentTask[]) {
  if (tasks.some((task) => task.status === 'RUNNING' || task.status === 'LEASED' || task.status === 'DOING')) return 'RUNNING'
  if (tasks.some((task) => task.status === 'PENDING' || task.status === 'WAITING' || task.status === 'READY' || task.status === 'REVIEW')) return 'WAITING'
  if (tasks.some((task) => task.status === 'ATTENTION')) return 'ATTENTION'
  if (tasks.some((task) => task.status === 'FAILED')) return 'FAILED'
  if (tasks.some((task) => task.status === 'DONE' || task.status === 'COMPLETE')) return 'DONE'
  return tasks[0]?.status || 'DONE'
}

function mainPrompt(tasks: ChatAgentTask[]) {
  for (const task of tasks) {
    const payload = objectValue(task.payload); const request = objectValue(payload.request)
    const value = firstText(payload.original_prompt, payload.prompt, request.text, request.prompt)
    if (value) return value
  }
  return ''
}

function normalizeTaskSource(task: ChatAgentTask): ProjectTaskSource {
  const source = String(task.source || '').toLowerCase()
  if (source.includes('orchestrat')) return 'orchestrator'
  if (source.includes('translat') || task.type === 'TRANSLATE_MARKDOWN') return 'translation'
  if (source.includes('release') || task.type === 'RELEASE_NOTES') return 'release'
  if (source.includes('todo') || task.type === 'TODO_CLASSIFY') return 'todo'
  if (source.includes('worker') || task.assigned_worker) return 'worker'
  if (source.includes('chat') || REQUEST_TASK_TYPES.has(task.type)) return 'chat'
  return 'system'
}

function mergeTaskPages(current: ChatAgentTask[], incoming: ChatAgentTask[]) {
  const merged = new Map(current.map((task) => [task.task_id, task]))
  for (const task of incoming) merged.set(task.task_id, task)
  return [...merged.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

function sourceLabel(source: ProjectTaskSource) { return ({ chat: 'Chat', worker: 'Worker', translation: 'Tradução', release: 'Release', todo: 'TODO', orchestrator: 'Orquestração', system: 'Sistema' })[source] }
function sourceIcon(source: ProjectTaskSource) {
  if (source === 'chat') return <Icon name="chatgpt" size={11}/>
  if (source === 'worker') return <Icon name="agent" size={11}/>
  if (source === 'orchestrator') return <Icon name="plan" size={11}/>
  if (source === 'translation') return <Icon name="file" size={11}/>
  if (source === 'release') return <Icon name="package" size={11}/>
  if (source === 'todo') return <Icon name="check" size={11}/>
  return <Icon name="terminal" size={11}/>
}
function taskTypeLabel(type: string) { const labels: Record<string, string> = { TRANSLATE_MARKDOWN: 'Tradução Markdown', RELEASE_NOTES: 'Notas de release', TODO_CLASSIFY: 'Classificação TODO', ORCHESTRATOR_TASK: 'Tarefa orquestrada', ORCHESTRATOR_PLAN: 'Planeamento do orquestrador', BOT_WRITE: 'Resposta do chat', RECOVERY_WRITE: 'Recuperação do chat', AWAIT_RESPONSE: 'Aguardar resposta' }; return labels[type] || type.replaceAll('_', ' ').toLocaleLowerCase().replace(/^./, (value) => value.toLocaleUpperCase()) }
function standaloneFallback(item: ProjectTask) { return item.kind === 'standalone' ? `${taskTypeLabel(item.taskType)} sem descrição adicional.` : 'Main Request registada sem texto de prompt disponível no payload durável.' }
function presentationPrompt(value: string) {
  const lines = value.split(/\r?\n/).filter((line) => !/^(WHARNEX (REQUEST METADATA|OUTPUT MODE)|EXPECTED_FILE:|Chat(Id|Hash|Title):|RequestedAt:|Do not answer this request|Build the required ZIP)/i.test(line.trim()))
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
function stringList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [] }
function objectValue(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; return value as Record<string, unknown> }
function firstText(...values: unknown[]) { for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim(); return '' }
function rootForRequest(session: Session | undefined, requestId: string) { if (!requestId) return ''; return session?.request_lineages?.[requestId]?.root_request_id || requestId }
function eventBelongsToRoot(event: HarnessEvent, root: string, session: Session) { const requestId = String(event.data?.request_id || ''); const eventRoot = String(event.data?.root_request_id || ''); return eventRoot === root || rootForRequest(session, requestId) === root }
function eventMatchesRoot(events: HarnessEvent[], planId: string, root: string, session: Session) { return events.some((event) => String(event.data?.plan_id || '') === planId && eventBelongsToRoot(event, root, session)) }
function mergeEvents(history: HarnessEvent[], live: HarnessEvent[]) { const merged = new Map<string, HarnessEvent>(); for (const event of history) merged.set(event.id, event); for (const event of live) merged.set(event.id, event); return [...merged.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)) }
function syntheticChat(item: ProjectTask): WorkspaceChat { return { id: item.chatId || item.key, title: item.title, sessionId: item.sessionId, createdAt: item.createdAt, updatedAt: item.updatedAt } }
function projectTaskState(item: ProjectTask) { if (item.disposition === 'archived') return 'Arquivada'; if (item.failed) return 'Atenção'; if (item.disposition === 'queue') return ACTIVE.has(item.tasks[0]?.status || '') ? requestStatusLabel(item.tasks[0]?.status || '') : 'Na fila'; return 'Concluída' }
function requestStatusLabel(status: string) { if (status === 'RUNNING' || status === 'LEASED' || status === 'DOING') return 'Em execução'; if (status === 'WAITING' || status === 'PENDING' || status === 'READY' || status === 'REVIEW') return 'Na fila'; if (status === 'ATTENTION') return 'Atenção'; if (status === 'FAILED') return 'Falhou'; if (status === 'CANCELLED') return 'Cancelada'; return 'Concluída' }
function requestKindLabel(kind: string) { const labels: Record<string, string> = { repair: 'Reparação', plan_approval: 'Aprovação', plan_correction: 'Correção do plano', execution_plan_adjustment: 'Ajuste de execução', revert_restore: 'Reversão', plan_reversal: 'Reversão do plano', improvement: 'Melhoria', evidence: 'Evidência', conflict: 'Conflito', knowledge_review: 'Conhecimento', knowledge_consolidation: 'Consolidação' }; return labels[kind] || 'Subtarefa' }
function emptyTitle(tab: ProjectTaskTab) { return tab === 'queue' ? 'Nenhuma tarefa em curso.' : tab === 'completed' ? 'Nenhuma tarefa concluída.' : 'Nenhuma tarefa arquivada.' }
function emptyDetail(tab: ProjectTaskTab) { return tab === 'queue' ? 'Chats, workers, traduções, releases e orquestrações aparecerão aqui quando tiverem trabalho.' : tab === 'completed' ? 'Tarefas finalizadas permanecem consultáveis com metadados e histórico.' : 'As tarefas arquivadas permanecem disponíveis para auditoria.' }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date) }

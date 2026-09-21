import { useEffect, useMemo, useState } from 'react'
import type { ChatAgentTask, HarnessEvent, Session } from '../types'
import { api } from '../lib/api'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import {
  collectExecutionActivities,
  collectPlanActivities,
  executionAuditEvents,
  executionEventsFromResult,
  groupMainRequestActivity,
  loadProjectSessions,
  sessionForPlan,
  type ExecutionActivityItem,
  type PlanActivityItem,
} from '../lib/projectActivity'
import { Icon } from './Icon'
import { PlanView, TerminalView } from './Inspector'
import { ChatAgentTaskTimeline } from './ChatAgentTaskTimeline'

const ACTIVE = new Set(['PENDING', 'LEASED', 'RUNNING', 'WAITING'])
const FAILED = new Set(['FAILED', 'ATTENTION'])
const REQUEST_TASK_TYPES = new Set(['AWAIT_RESPONSE', 'BOT_WRITE', 'RECOVERY_WRITE', 'ORCHESTRATOR_PLAN'])
type ProjectTaskTab = 'queue' | 'completed' | 'archived'

type ProjectTask = {
  key: string
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

export function ProjectTasksDrawer({ projectPath, chats, savedChats, archivedChats, currentSession, activeChatId, activeEvents, onClose, onError, onGoToChat }: {
  projectPath: string
  chats: WorkspaceChat[]
  savedChats: WorkspaceChat[]
  archivedChats: WorkspaceChat[]
  currentSession: Session
  activeChatId: string
  activeEvents: HarnessEvent[]
  onClose: () => void
  onError?: (message: string) => void
  onGoToChat?: (chatId?: string, sessionId?: string) => void
}) {
  const [runtimeTasks, setRuntimeTasks] = useState<ChatAgentTask[]>([])
  const [sessions, setSessions] = useState<Record<string, Session>>({ [currentSession.id]: currentSession })
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<ProjectTaskTab>('queue')
  const allChats = useMemo(() => [...chats, ...savedChats, ...archivedChats], [archivedChats, chats, savedChats])
  const chatKey = JSON.stringify([...new Set(allChats.map((chat) => chat.sessionId).filter(Boolean))].sort())

  useEffect(() => { setSessions((current) => ({ ...current, [currentSession.id]: currentSession })) }, [currentSession])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([
      api.chatAgentTasks(false, projectPath, 500),
      loadProjectSessions(JSON.parse(chatKey) as string[], api.getSession),
    ]).then(([taskResult, sessionResult]) => {
      if (cancelled) return
      setRuntimeTasks(Array.isArray(taskResult.tasks) ? taskResult.tasks : [])
      setSessions((current) => ({ ...current, ...sessionResult.sessions, [currentSession.id]: currentSession }))
      if (sessionResult.failed) onError?.(`Não foi possível carregar ${sessionResult.failed} ${sessionResult.failed === 1 ? 'sessão' : 'sessões'} para compor o histórico das tarefas.`)
    }).catch((error) => {
      if (!cancelled) onError?.(error instanceof Error ? error.message : 'Não foi possível carregar as tarefas do projeto.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [chatKey, currentSession, onError, projectPath])

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void api.chatAgentTasks(false, projectPath, 500).then((result) => {
        if (!cancelled) setRuntimeTasks(Array.isArray(result.tasks) ? result.tasks : [])
      }).catch(() => undefined)
    }
    const timer = window.setInterval(refresh, 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [projectPath])

  const tasks = useMemo(() => buildProjectTasks(runtimeTasks, allChats, sessions), [allChats, runtimeTasks, sessions])
  const counts = useMemo(() => ({
    queue: tasks.filter((item) => item.disposition === 'queue').length,
    completed: tasks.filter((item) => item.disposition === 'completed').length,
    archived: tasks.filter((item) => item.disposition === 'archived').length,
  }), [tasks])
  const visible = useMemo(() => tasks.filter((item) => item.disposition === tab), [tab, tasks])

  useEffect(() => {
    if (loading || counts[tab] > 0) return
    const next = (['queue', 'completed', 'archived'] as ProjectTaskTab[]).find((candidate) => counts[candidate] > 0)
    if (next) setTab(next)
  }, [counts, loading, tab])

  return <section className="project-tasks-drawer" aria-label="Tarefas do projeto">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Projeto inteiro</span><strong>Tarefas</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar tarefas"><Icon name="close" size={13}/></button></header>
    <p className="project-task-intro">Cada Main Request do chat é uma tarefa. As continuações e reparações aparecem como subtarefas GPT, e o plano, execuções e logs ficam juntos no mesmo cartão.</p>
    <nav className="project-task-tabs" role="tablist" aria-label="Estados das tarefas">
      <TaskTab id="queue" label="Fila" icon="list" count={counts.queue} active={tab === 'queue'} onClick={() => setTab('queue')}/>
      <TaskTab id="completed" label="Concluídas" icon="check" count={counts.completed} active={tab === 'completed'} onClick={() => setTab('completed')}/>
      <TaskTab id="archived" label="Arquivadas" icon="archive" count={counts.archived} active={tab === 'archived'} onClick={() => setTab('archived')}/>
    </nav>
    <div id="project-task-panel" className="project-task-list" role="tabpanel">
      {loading && !tasks.length ? <div className="agent-drawer-empty">A carregar tarefas, planos e histórico…</div> : visible.length ? visible.map((item) => <ProjectTaskCard key={item.key} item={item} currentSession={currentSession} activeChatId={activeChatId} activeEvents={activeEvents} onGoToChat={onGoToChat}/>) : <div className="agent-drawer-empty"><strong>{emptyTitle(tab)}</strong><span>{emptyDetail(tab)}</span></div>}
    </div>
  </section>
}

function TaskTab({ id, label, icon, count, active, onClick }: { id: ProjectTaskTab; label: string; icon: 'list' | 'check' | 'archive'; count: number; active: boolean; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} aria-controls="project-task-panel" onClick={onClick} data-task-tab={id}><Icon name={icon} size={13}/><span className="semantic-tab-label">{label}</span><b>{count}</b></button>
}

function ProjectTaskCard({ item, currentSession, activeChatId, activeEvents, onGoToChat }: { item: ProjectTask; currentSession: Session; activeChatId: string; activeEvents: HarnessEvent[]; onGoToChat?: (chatId?: string, sessionId?: string) => void }) {
  const [opened, setOpened] = useState(false)
  const state = projectTaskState(item)
  return <article className={`project-task-card ${item.disposition} ${item.failed ? 'failed' : ''}`}>
    <div className="project-task-card-heading"><div><span className="project-task-state"><i aria-hidden="true"/>{state}</span><strong>{item.chat?.title || 'Main Request'}</strong></div><time dateTime={item.updatedAt}>{formatDate(item.updatedAt)}</time></div>
    <p className="project-task-prompt">{item.prompt || 'Main Request registada sem texto de prompt disponível no payload durável.'}</p>
    <div className="project-task-card-meta"><code>{item.rootRequestId}</code><span>{item.requests.length} {item.requests.length === 1 ? 'requisição GPT' : 'requisições GPT'}</span>{item.failed ? <span className="danger">Requer atenção</span> : null}</div>
    {onGoToChat && item.chatId ? <div className="project-task-actions"><button type="button" onClick={() => onGoToChat(item.chatId, item.sessionId)}><Icon name="bridge" size={12}/> Ver chat</button></div> : null}
    <details className="project-task-details" onToggle={(event) => setOpened(event.currentTarget.open)}><summary><span>Plano, subtarefas, execuções e logs</span></summary>{opened ? <ProjectTaskDetail item={item} currentSession={currentSession} activeChatId={activeChatId} activeEvents={activeEvents}/> : null}</details>
  </article>
}

function ProjectTaskDetail({ item, currentSession, activeChatId, activeEvents }: { item: ProjectTask; currentSession: Session; activeChatId: string; activeEvents: HarnessEvent[] }) {
  const [history, setHistory] = useState<HarnessEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const session = item.session || (item.sessionId === currentSession.id ? currentSession : undefined)

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
  const rootEvents = useMemo(() => {
    if (!session) return []
    return groupMainRequestActivity(session, history).find((group) => group.rootRequestId === item.rootRequestId)?.events || []
  }, [history, item.rootRequestId, session])
  const anchorTask = item.tasks.find((task) => task.type === 'AWAIT_RESPONSE' && (task.root_request_id || task.request_id) === item.rootRequestId) || item.tasks.find((task) => task.type === 'AWAIT_RESPONSE')

  return <div className="project-task-detail-grid">
    <section><header><Icon name="chatgpt" size={12}/><strong>Subtarefas GPT</strong><span>{item.requests.length}</span></header><div className="project-task-request-list">{item.requests.map((request) => <div key={request.requestId}><div><b>{request.requestId === item.rootRequestId ? 'Principal' : requestKindLabel(request.kind)}</b><code>{request.requestId}</code></div><span className={`request-state ${request.status.toLowerCase()}`}>{requestStatusLabel(request.status)}</span><small>{request.tasks.length} {request.tasks.length === 1 ? 'etapa de transporte' : 'etapas de transporte'} · {formatDate(request.createdAt)}</small></div>)}</div></section>
    <section><header><Icon name="plan" size={12}/><strong>Planos de execução</strong><span>{plans.length}</span></header>{plans.length ? <div className="project-task-plan-list">{plans.map((plan) => <PlanHistory key={plan.id} item={plan}/>)}</div> : <p className="project-task-empty-detail">Nenhum plano foi registado para esta Main Request.</p>}</section>
    <section><header><Icon name="history" size={12}/><strong>Execuções</strong><span>{executions.length}</span></header>{executions.length ? <div className="project-task-execution-list">{executions.map((execution) => <ExecutionHistory key={execution.id} item={execution} events={history}/>)}</div> : <p className="project-task-empty-detail">Nenhuma execução foi registada para esta Main Request.</p>}</section>
    <section><header><Icon name="history" size={12}/><strong>Log completo da tarefa</strong><span>{rootEvents.length}</span></header>{loading ? <p className="project-task-empty-detail">A carregar audit log…</p> : historyError ? <p className="project-task-empty-detail danger">{historyError}</p> : rootEvents.length ? <div className="project-task-terminal"><TerminalView events={rootEvents}/></div> : <p className="project-task-empty-detail">Sem eventos de auditoria correlacionados.</p>}</section>
    {anchorTask ? <section><header><Icon name="agent" size={12}/><strong>Transporte ChatGPT</strong></header><ChatAgentTaskTimeline taskId={anchorTask.task_id} enabled/></section> : null}
  </div>
}

function PlanHistory({ item }: { item: PlanActivityItem }) {
  return <details><summary><span><b>{item.plan.summary || item.plan.plan_id}</b><small>{item.label} · {formatDate(item.timestamp)}</small></span><code>{item.plan.plan_id}</code></summary><div className="project-task-plan-view"><PlanView session={sessionForPlan(item)} readOnly/></div></details>
}

function ExecutionHistory({ item, events }: { item: ExecutionActivityItem; events: HarnessEvent[] }) {
  const audit = executionAuditEvents(events, item)
  const visible = audit.length ? audit : executionEventsFromResult(item.execution, item.session.id)
  return <details><summary><span><b>{item.execution.success ? 'Execução concluída' : 'Execução com falha'}</b><small>{formatDate(item.timestamp)} · {item.execution.commands.length} comandos</small></span><code>{item.execution.plan_id}</code></summary><div className="project-task-terminal"><TerminalView events={visible}/></div></details>
}

function buildProjectTasks(tasks: ChatAgentTask[], chats: WorkspaceChat[], sessions: Record<string, Session>): ProjectTask[] {
  const chatByID = new Map(chats.map((chat) => [chat.id, chat]))
  const archived = new Set(chats.filter((chat) => Boolean(chat.archivedAt)).map((chat) => chat.id))
  const groups = new Map<string, ChatAgentTask[]>()
  for (const task of tasks) {
    if (!REQUEST_TASK_TYPES.has(task.type) || !task.request_id) continue
    const session = sessions[task.session_id]
    const root = session?.request_lineages?.[task.request_id]?.root_request_id || task.root_request_id || task.request_id
    const key = `${task.chat_id || task.session_id}:${root}`
    const bucket = groups.get(key) || []
    bucket.push(task); groups.set(key, bucket)
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
    const disposition: ProjectTaskTab = archived.has(first.chat_id) ? 'archived' : active || failed ? 'queue' : 'completed'
    result.push({
      key, rootRequestId, chatId: first.chat_id, sessionId: first.session_id,
      prompt: mainPrompt(bucket), createdAt: first.created_at, updatedAt: bucket.reduce((latest, task) => task.updated_at > latest ? task.updated_at : latest, first.updated_at),
      tasks: bucket, requests, disposition, failed, chat: chatByID.get(first.chat_id), session,
    })
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function groupRequests(tasks: ChatAgentTask[], session: Session | undefined, rootRequestId: string): ProjectTask['requests'] {
  const groups = new Map<string, ChatAgentTask[]>()
  for (const task of tasks) {
    const bucket = groups.get(task.request_id) || []
    bucket.push(task); groups.set(task.request_id, bucket)
  }
  return [...groups].map(([requestId, bucket]) => ({
    requestId,
    kind: requestId === rootRequestId ? 'standard' : session?.request_lineages?.[requestId]?.kind || 'continuation',
    status: requestAggregateStatus(bucket),
    createdAt: bucket.reduce((earliest, task) => task.created_at < earliest ? task.created_at : earliest, bucket[0].created_at),
    tasks: bucket,
  })).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function requestAggregateStatus(tasks: ChatAgentTask[]) {
  if (tasks.some((task) => task.status === 'RUNNING' || task.status === 'LEASED')) return 'RUNNING'
  if (tasks.some((task) => task.status === 'PENDING' || task.status === 'WAITING')) return 'WAITING'
  if (tasks.some((task) => task.status === 'ATTENTION')) return 'ATTENTION'
  if (tasks.some((task) => task.status === 'FAILED')) return 'FAILED'
  if (tasks.some((task) => task.status === 'DONE')) return 'DONE'
  return tasks[0]?.status || 'DONE'
}

function mainPrompt(tasks: ChatAgentTask[]) {
  for (const task of tasks) {
    const payload = objectValue(task.payload)
    const request = objectValue(payload.request)
    const value = firstText(payload.original_prompt, payload.prompt, request.text, request.prompt)
    if (value) return value
  }
  return ''
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}
function firstText(...values: unknown[]) { for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim(); return '' }

function rootForRequest(session: Session | undefined, requestId: string) {
  if (!requestId) return ''
  return session?.request_lineages?.[requestId]?.root_request_id || requestId
}

function eventBelongsToRoot(event: HarnessEvent, root: string, session: Session) {
  const requestId = String(event.data?.request_id || '')
  const eventRoot = String(event.data?.root_request_id || '')
  return eventRoot === root || rootForRequest(session, requestId) === root
}

function eventMatchesRoot(events: HarnessEvent[], planId: string, root: string, session: Session) {
  return events.some((event) => String(event.data?.plan_id || '') === planId && eventBelongsToRoot(event, root, session))
}

function mergeEvents(history: HarnessEvent[], live: HarnessEvent[]) {
  const merged = new Map<string, HarnessEvent>()
  for (const event of history) merged.set(event.id, event)
  for (const event of live) merged.set(event.id, event)
  return [...merged.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function syntheticChat(item: ProjectTask): WorkspaceChat {
  return { id: item.chatId || item.key, title: item.chat?.title || 'Main Request', sessionId: item.sessionId, createdAt: item.createdAt, updatedAt: item.updatedAt }
}

function projectTaskState(item: ProjectTask) {
  if (item.disposition === 'archived') return 'Arquivada'
  if (item.failed) return 'Atenção'
  if (item.disposition === 'queue') return 'Na fila'
  return 'Concluída'
}
function requestStatusLabel(status: string) {
  if (status === 'RUNNING' || status === 'LEASED') return 'Em execução'
  if (status === 'WAITING' || status === 'PENDING') return 'Na fila'
  if (status === 'ATTENTION') return 'Atenção'
  if (status === 'FAILED') return 'Falhou'
  if (status === 'CANCELLED') return 'Cancelada'
  return 'Concluída'
}
function requestKindLabel(kind: string) {
  const labels: Record<string, string> = { repair: 'Reparação', plan_approval: 'Aprovação', plan_correction: 'Correção do plano', execution_plan_adjustment: 'Ajuste de execução', revert_restore: 'Reversão', plan_reversal: 'Reversão do plano', improvement: 'Melhoria', evidence: 'Evidência', conflict: 'Conflito', knowledge_review: 'Conhecimento', knowledge_consolidation: 'Consolidação' }
  return labels[kind] || 'Subtarefa'
}
function emptyTitle(tab: ProjectTaskTab) { return tab === 'queue' ? 'Fila vazia.' : tab === 'completed' ? 'Nenhuma tarefa concluída.' : 'Nenhuma tarefa arquivada.' }
function emptyDetail(tab: ProjectTaskTab) { return tab === 'queue' ? 'As próximas Main Requests e continuações GPT aparecerão aqui.' : tab === 'completed' ? 'Tarefas finalizadas permanecem consultáveis com plano, execução e logs.' : 'As tarefas dos chats arquivados aparecerão aqui enquanto o histórico durável estiver disponível.' }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date) }

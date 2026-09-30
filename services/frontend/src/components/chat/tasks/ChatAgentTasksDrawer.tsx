import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChatAgentQueueSummary, ChatAgentTask } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { desktopBridge } from '../../../lib/desktop/bridge/desktop'
import { extractWorkerId, resolveTaskChatId, type ChatAgentTaskChatRef } from '../../../lib/chat/transport/chatAgentTaskNav'
import { ChatAgentTaskTimeline } from './ChatAgentTaskTimeline'
import { Icon } from '../../presentation/chrome/Icon'

const RUNNING = new Set(['LEASED', 'RUNNING'])
const QUEUED = new Set(['PENDING', 'WAITING'])
const ACCOUNT_TASKS = new Set(['ORGANIZE_CHAT', 'RENAME_CHAT', 'ARCHIVE_CHAT', 'DELETE_CHAT', 'DELETE_BUNDLE', 'DELETE_TEMP_CHAT'])
const WRITER_TASKS = new Set(['TRANSLATE_MARKDOWN', 'BOT_WRITE', 'RECOVERY_WRITE', 'ORGANIZE_CHAT', 'RENAME_CHAT', 'ARCHIVE_CHAT', 'DELETE_CHAT', 'DELETE_TEMP_CHAT'])
const QUIET_WHILE_AWAITING = new Set(['ORGANIZE_CHAT', 'RENAME_CHAT', 'ARCHIVE_CHAT', 'DELETE_CHAT', 'TITLE_DISCOVER', 'TITLE_GENERATE_TEMP'])
const REFRESH_MS = 5_000
type TaskDisposition = 'running' | 'due' | 'scheduled' | 'guarded' | 'blocked'
const TASK_LABELS: Record<string, string> = {
  BOT_WRITE: 'Enviar pedido', RECOVERY_WRITE: 'Enviar correção', AWAIT_RESPONSE: 'Aguardar resposta',
  TITLE_DISCOVER: 'Ler título', TITLE_GENERATE_TEMP: 'Gerar título', TITLE_AWAIT: 'Aguardar título',
  ORGANIZE_CHAT: 'Organizar chat', RENAME_CHAT: 'Renomear chat', ARCHIVE_CHAT: 'Arquivar chat',
  DELETE_CHAT: 'Eliminar chat', DELETE_BUNDLE: 'Limpar bundle', DELETE_TEMP_CHAT: 'Limpar chat temporário',
}

export function ChatAgentTasksDrawer({ projectPath, onClose, onError, chats = [], onGoToChat, onGoToOrchestrator, onFollowInstance }: {
  // The project this drawer belongs to. One durable queue serves every open
  // project, so without it the panel showed each project the other projects'
  // chats, request ids and lineage — and answered a question about a backlog
  // the operator was not looking at (see adr/ADR-0044).
  projectPath: string
  onClose: () => void
  onError?: (message: string) => void
  // Minimal shape only: resolving a task's owning Harness chat needs just the
  // id/sessionId pair, never the full workspace-chat record.
  chats?: ChatAgentTaskChatRef[]
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onGoToOrchestrator?: () => void
  onFollowInstance?: (agentId: string, chatId?: string, sessionId?: string) => void
}) {
  const [tasks, setTasks] = useState<ChatAgentTask[]>([])
  const [queueSummary, setQueueSummary] = useState<ChatAgentQueueSummary>()
  const [loading, setLoading] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState(Date.now())
  const [workers, setWorkers] = useState<DesktopAgentRuntimeAgent[]>([])
  const [activeTab, setActiveTab] = useState<TaskDisposition>('running')

  const refresh = useCallback(async () => {
    try {
      const bridge = desktopBridge()?.agents
      const [result, summary, runtime] = await Promise.all([
        api.chatAgentTasks(true, projectPath),
        api.chatAgentTaskSummary(projectPath),
        bridge ? bridge.state().catch(() => undefined) : Promise.resolve(undefined),
      ])
      setTasks(Array.isArray(result.tasks) ? result.tasks : [])
      setQueueSummary(summary)
      if (runtime) setWorkers(runtime.agents.filter((agent) => agent.role === 'worker' && !agent.draining && agent.loop_active !== false && agent.status !== 'stopped'))
      setRefreshedAt(Date.now())
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Não foi possível carregar as tarefas')
    } finally {
      setLoading(false)
    }
  }, [onError, projectPath])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const groups = useMemo(() => {
    const next = {
      running: [] as ChatAgentTask[],
      due: [] as ChatAgentTask[],
      scheduled: [] as ChatAgentTask[],
      guarded: [] as ChatAgentTask[],
      blocked: [] as ChatAgentTask[],
      guardReasons: new Map<string, string>(),
    }
    for (const task of tasks) {
      if (RUNNING.has(task.status)) {
        next.running.push(task)
      } else if (QUEUED.has(task.status)) {
        if (task.attempt >= task.max_attempts) next.blocked.push(task)
        else if (isScheduled(task, refreshedAt)) next.scheduled.push(task)
        else {
          const reason = taskGuardReason(task, tasks, refreshedAt)
          if (reason) {
            next.guarded.push(task)
            next.guardReasons.set(task.task_id, reason)
          } else next.due.push(task)
        }
      }
    }
    // The provider-wide pause is visible only in the aggregate. If every
    // locally unguarded due task is accounted for by the summary's remaining
    // guarded count, reconcile those cards without inventing Worker backlog.
    const aggregateGuardRemainder = (queueSummary?.guarded ?? 0) - next.guarded.length
    if (queueSummary?.due === 0 && aggregateGuardRemainder === next.due.length) {
      for (const task of next.due) {
        next.guarded.push(task)
        next.guardReasons.set(task.task_id, 'A aguardar liberação do provider')
      }
      next.due = []
    }
    next.running.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    next.due.sort(compareDueTasks)
    next.scheduled.sort(compareScheduledTasks)
    next.guarded.sort(compareDueTasks)
    next.blocked.sort(compareDueTasks)
    return next
  }, [queueSummary, refreshedAt, tasks])

  const runningCount = queueSummary
    ? (queueSummary.counts.RUNNING || 0) + (queueSummary.counts.LEASED || 0)
    : groups.running.length
  const dueCount = queueSummary?.due ?? groups.due.length
  const scheduledCount = queueSummary?.scheduled ?? groups.scheduled.length
  const guardedCount = queueSummary?.guarded ?? groups.guarded.length
  const blockedCount = queueSummary?.blocked ?? groups.blocked.length
  // The agent pool is shared with every other open project, so an empty queue
  // here does not mean an idle pool. This is a bare count on purpose: what that
  // work is belongs to the project that owns it, not to this panel.
  const otherProjectsCount = queueSummary?.other_projects ?? 0
  const taskTabs = useMemo(() => [
    { id: 'running', label: 'Em execução', icon: 'play', count: runningCount },
    { id: 'due', label: 'Por executar', icon: 'list', count: dueCount },
    { id: 'guarded', label: 'Aguardam liberação', icon: 'shield', count: guardedCount },
    { id: 'scheduled', label: 'Agendadas', icon: 'history', count: scheduledCount },
    { id: 'blocked', label: 'Sem tentativas', icon: 'alert', count: blockedCount },
  ] as const, [blockedCount, dueCount, guardedCount, runningCount, scheduledCount])

  useEffect(() => {
    if (loading || taskTabs.some((tab) => tab.id === activeTab && tab.count > 0)) return
    const next = taskTabs.find((tab) => tab.count > 0)
    if (next) setActiveTab(next.id)
  }, [activeTab, loading, taskTabs])

  const assignTask = async (task: ChatAgentTask, workerID: string, keepFlowing: boolean) => {
    try {
      await api.assignChatAgentTask(task.task_id, workerID, keepFlowing)
      await refresh()
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Não foi possível atribuir a tarefa ao Worker')
      throw error
    }
  }

  return <section className="chat-agent-tasks-drawer" aria-label="Tarefas do runtime ChatGPT">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Runtime ChatGPT</span><strong>Tarefas</strong></div><div className="agent-runtime-heading-actions"><button type="button" className="agent-drawer-icon" onClick={() => void refresh()} aria-label="Atualizar tarefas"><Icon name="refresh" size={13}/></button><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar tarefas"><Icon name="close" size={13}/></button></div></header>
    <div className="chat-agent-tasks-summary"><span><b>{runningCount}</b> em execução</span><span><b>{dueCount}</b> por executar</span><span><b>{scheduledCount}</b> {scheduledCount === 1 ? 'agendada' : 'agendadas'}</span>{guardedCount > 0 ? <span><b>{guardedCount}</b> {guardedCount === 1 ? 'aguarda liberação' : 'aguardam liberação'}</span> : null}{blockedCount > 0 ? <span><b>{blockedCount}</b> sem tentativas</span> : null}<small>Atualizado {relativeAge(refreshedAt)}</small></div>
    <p className="chat-agent-tasks-scope">Apenas as tarefas deste projeto.{otherProjectsCount > 0 ? ` Os agentes são partilhados e executam também ${otherProjectsCount} ${otherProjectsCount === 1 ? 'tarefa ativa de outro projeto' : 'tarefas ativas de outros projetos'}.` : ''}</p>
    {!loading && tasks.length > 0 ? <nav className="chat-agent-task-tabs" role="tablist" aria-label="Estados das tarefas">
      {taskTabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls="chat-agent-task-panel" onClick={() => setActiveTab(tab.id)}><Icon name={tab.icon} size={13}/><span className="semantic-tab-label">{tab.label}</span><b>{tab.count}</b></button>)}
    </nav> : null}
    <div id="chat-agent-task-panel" className="chat-agent-tasks-body" role="tabpanel">
      {loading ? <div className="agent-drawer-empty">A carregar fila durável…</div> : !tasks.length ? <div className="agent-drawer-empty"><strong>Sem tarefas ativas neste projeto.</strong><span>{otherProjectsCount > 0 ? 'A fila deste projeto está vazia, mas os agentes partilhados estão ocupados com outros projetos.' : 'A fila e os Workers estão livres neste momento.'}</span></div> : activeTab === 'running' ?
        <TaskSection title="Em execução" description="Instâncias com trabalho ativo neste momento." tasks={groups.running} empty="Nenhum Worker está a executar uma tarefa." disposition="running" chats={chats} onGoToChat={onGoToChat} onGoToOrchestrator={onGoToOrchestrator} onFollowInstance={onFollowInstance} workers={workers} onAssignTask={assignTask}/> : activeTab === 'due' ?
        <TaskSection title="Por executar" description="Fila pronta para atribuição, ordenada por prioridade." tasks={groups.due} empty="Nenhuma tarefa está pronta para atribuição." disposition="due" showPosition chats={chats} onGoToChat={onGoToChat} onGoToOrchestrator={onGoToOrchestrator} onFollowInstance={onFollowInstance} workers={workers} onAssignTask={assignTask}/> : activeTab === 'guarded' ?
        <TaskSection title="Aguardam liberação" description="Trabalho protegido por conversa, conta ou provider." tasks={groups.guarded} empty="Nenhuma tarefa aguarda liberação." disposition="guarded" guardReasons={groups.guardReasons} chats={chats} onGoToChat={onGoToChat} onGoToOrchestrator={onGoToOrchestrator} workers={workers} onAssignTask={assignTask}/> : activeTab === 'scheduled' ?
        <TaskSection title="Agendadas" description={`Aguardam a data de execução, não um Worker.${groups.scheduled.length ? ` Próxima: ${timeLabel(queueSummary?.next_not_before || groups.scheduled[0].not_before)}` : ''}`} tasks={groups.scheduled} empty="Nenhuma tarefa está agendada." disposition="scheduled" chats={chats} onGoToChat={onGoToChat} onGoToOrchestrator={onGoToOrchestrator} workers={workers} onAssignTask={assignTask}/> :
        <TaskSection title="Sem tentativas" description="Tarefas que atingiram o limite configurado de tentativas." tasks={groups.blocked} empty="Nenhuma tarefa está bloqueada por tentativas." disposition="blocked" chats={chats} onGoToChat={onGoToChat} onGoToOrchestrator={onGoToOrchestrator} workers={workers} onAssignTask={assignTask}/>}
    </div>
  </section>
}

type TaskNavProps = {
  chats?: ChatAgentTaskChatRef[]
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onGoToOrchestrator?: () => void
  onFollowInstance?: (agentId: string, chatId?: string, sessionId?: string) => void
  workers?: DesktopAgentRuntimeAgent[]
  onAssignTask?: (task: ChatAgentTask, workerID: string, keepFlowing: boolean) => Promise<void>
}

function TaskSection({ title, description, tasks, empty, disposition, guardReasons, showPosition = false, chats, onGoToChat, onGoToOrchestrator, onFollowInstance, workers, onAssignTask }: { title: string; description?: string; tasks: ChatAgentTask[]; empty: string; disposition: TaskDisposition; guardReasons?: Map<string, string>; showPosition?: boolean } & TaskNavProps) {
  return <section className="chat-agent-task-section"><header><div><strong>{title}</strong>{description ? <small>{description}</small> : null}</div><span>{tasks.length}</span></header>{tasks.length ? <div className="chat-agent-task-list">{tasks.map((task, index) => <TaskCard key={task.task_id} task={task} disposition={disposition} guardReason={guardReasons?.get(task.task_id)} queuePosition={showPosition ? index + 1 : undefined} chats={chats} onGoToChat={onGoToChat} onGoToOrchestrator={onGoToOrchestrator} onFollowInstance={onFollowInstance} workers={workers} onAssignTask={onAssignTask}/>)}</div> : <p>{empty}</p>}</section>
}

// A task only ever offers the navigation it can actually resolve: following an
// instance needs a live Worker lease, going to chat needs a chat/session id
// that matches a known Harness chat, and going to orchestration is offered
// only for a task whose origin is the Orchestrator planning pipeline. Guessing
// any of these from partial data would send the operator somewhere wrong.
function TaskCard({ task, disposition, guardReason, queuePosition, chats = [], onGoToChat, onGoToOrchestrator, onFollowInstance, workers = [], onAssignTask }: { task: ChatAgentTask; disposition: TaskDisposition; guardReason?: string; queuePosition?: number } & TaskNavProps) {
  const running = disposition === 'running'
  const [assignmentWorker, setAssignmentWorker] = useState(task.assigned_worker || '')
  const [assignmentMode, setAssignmentMode] = useState<'standard' | 'keep_flowing'>(task.keep_flowing ? 'keep_flowing' : 'standard')
  const [assigning, setAssigning] = useState(false)
  // Fetching the durable per-task ledger for every visible card on every 5s
  // refresh would fan the drawer's one poll out into one request per card.
  // Load it only once the operator actually opens "Detalhes", and keep it
  // loaded afterwards even if they collapse it again.
  const [detailsOpened, setDetailsOpened] = useState(false)
  useEffect(() => { setAssignmentWorker(task.assigned_worker || ''); setAssignmentMode(task.keep_flowing ? 'keep_flowing' : 'standard') }, [task.assigned_worker, task.keep_flowing])
  const workerId = running ? extractWorkerId(task.lease_owner) : undefined
  const resolvedChatId = resolveTaskChatId(task, chats)
  const orchestratorOrigin = task.type === 'ORCHESTRATOR_PLAN'
  const schedule = running
    ? `Lease ${relativeMoment(task.lease_expires_at)}`
    : disposition === 'scheduled'
      ? `Execução agendada ${relativeMoment(task.not_before)}`
      : disposition === 'guarded'
        ? guardReason || 'A aguardar liberação do runtime'
      : disposition === 'blocked'
        ? 'Limite de tentativas atingido'
        : 'Pronta para atribuição'

  return <article className={`chat-agent-task-card ${task.status.toLowerCase()} ${disposition}`}>
    <div className="chat-agent-task-heading">
      <div className="chat-agent-task-identity"><span className={`agent-runtime-dot ${running ? (task.status === 'RUNNING' ? 'running' : 'claimed') : 'loading'}`} aria-hidden="true"/><div><strong>{taskTypeLabel(task.type)}</strong><code>{task.type}</code></div></div>
      <div className="chat-agent-task-heading-meta">{queuePosition ? <em aria-label={`Posição ${queuePosition} na fila`}>#{String(queuePosition).padStart(2, '0')}</em> : null}<span className="chat-agent-task-state">{statusLabel(task.status, disposition)}</span></div>
    </div>
    <div className="chat-agent-task-worker"><span><Icon name="agent" size={13}/><b>{assignmentLabel(task, disposition)}</b></span><small title={schedule}>{schedule}</small></div>
    {!running && disposition !== 'blocked' && workers.length > 0 && onAssignTask ? <div className="chat-agent-task-assignment" aria-label="Atribuir tarefa ao Worker"><select aria-label="Worker" value={assignmentWorker} disabled={assigning} onChange={(event) => setAssignmentWorker(event.target.value)}><option value="">Selecionar Worker…</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.label} · {statusLabelForWorker(worker)}</option>)}</select><select aria-label="Modo de execução" value={assignmentMode} disabled={assigning} onChange={(event) => setAssignmentMode(event.target.value === 'keep_flowing' ? 'keep_flowing' : 'standard')}><option value="standard">Modo atual do Worker</option><option value="keep_flowing">Keep flowing temporário</option></select><button type="button" disabled={assigning || !assignmentWorker} onClick={() => { if (!assignmentWorker) return; setAssigning(true); void onAssignTask(task, assignmentWorker, assignmentMode === 'keep_flowing').finally(() => setAssigning(false)) }}>{assigning ? 'A atribuir…' : 'Atribuir'}</button></div> : null}
    {((workerId && onFollowInstance) || (resolvedChatId && onGoToChat) || (orchestratorOrigin && onGoToOrchestrator)) && <div className="chat-agent-task-nav" aria-label="Navegação da tarefa">
      {workerId && onFollowInstance ? <button type="button" onClick={() => onFollowInstance(workerId, resolvedChatId, task.session_id)} title="Acompanhar em tempo real a instância do Worker que executa esta tarefa"><Icon name="monitor" size={13}/> Acompanhar instância</button> : null}
      {resolvedChatId && onGoToChat ? <button type="button" onClick={() => onGoToChat(resolvedChatId, task.session_id)} title="Abrir o chat Harness desta tarefa"><Icon name="bridge" size={13}/> Ver chat</button> : null}
      {orchestratorOrigin && onGoToOrchestrator ? <button type="button" onClick={() => onGoToOrchestrator()} title="Abrir o Orchestrator para este planeamento"><Icon name="plan" size={13}/> Ver orquestração</button> : null}
    </div>}
    <div className="chat-agent-task-metrics" aria-label="Resumo da tarefa">
      <TaskMetric label={disposition === 'scheduled' ? 'Criada' : 'Fila'} value={relativeAge(task.created_at)}/>
      <TaskMetric label="Atividade" value={relativeAge(task.updated_at)}/>
      <TaskMetric label="Tentativa" value={`${task.attempt}/${task.max_attempts}`}/>
    </div>
    {task.last_error ? <div className="chat-agent-task-error"><Icon name="bell" size={13}/><span>{task.last_error}</span></div> : null}
    <details className="chat-agent-task-details" onToggle={(event) => { if (event.currentTarget.open) setDetailsOpened(true) }}><summary><span>Detalhes</span></summary><div className="chat-agent-task-detail-grid">
      <TaskDetails title="Execução" rows={[
        ['Entrou na fila', `${timeLabel(task.created_at)} · ${relativeAge(task.created_at)}`],
        ['Último trabalho', `${statusLabel(task.status, disposition)} · ${timeLabel(task.updated_at)} · ${relativeAge(task.updated_at)}`],
        ['Tentativa', `${task.attempt}/${task.max_attempts} · prioridade ${task.priority}`],
        ['Executar após', timeLabel(task.not_before)],
      ]}/>
      <TaskDetails title="Identificadores" rows={[
        ['Task', task.task_id], ['Request', task.request_id || '—'], ['Chat', task.chat_id || '—'], ['Lineage', task.root_request_id || '—'],
        ['Project', task.project_id || '—'], ['Session', task.session_id || '—'], ['Conversation', task.conversation_id || '—'],
        ['Parent task', task.parent_task_id || '—'], ['Dedupe', task.dedupe_key || '—'], ['Lease owner', task.lease_owner || '—'],
      ]}/>
      <pre>{formatPayload(task.payload)}</pre>
      <ChatAgentTaskTimeline taskId={task.task_id} enabled={detailsOpened}/>
    </div></details>
  </article>
}

function TaskMetric({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><b>{value}</b></span>
}

function TaskDetails({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <section><strong>{title}</strong><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl></section>
}

function isScheduled(task: ChatAgentTask, now: number) {
  const notBefore = Date.parse(task.not_before)
  return Number.isFinite(notBefore) && notBefore > now
}

function taskGuardReason(candidate: ChatAgentTask, tasks: ChatAgentTask[], now: number) {
  if (candidate.conversation_id && QUIET_WHILE_AWAITING.has(candidate.type)) {
    const supervised = tasks.some((task) => task.task_id !== candidate.task_id && task.conversation_id === candidate.conversation_id && task.type === 'AWAIT_RESPONSE' && (RUNNING.has(task.status) || (QUEUED.has(task.status) && task.attempt < task.max_attempts)))
    if (supervised) return 'A aguardar conclusão da resposta'
  }
  for (const task of tasks) {
    if (task.task_id === candidate.task_id || !RUNNING.has(task.status)) continue
    const leaseExpiresAt = Date.parse(String(task.lease_expires_at || ''))
    if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= now) continue
    if (ACCOUNT_TASKS.has(candidate.type) && ACCOUNT_TASKS.has(task.type)) return 'A aguardar tarefa protegida da conta'
    if (candidate.conversation_id && candidate.conversation_id === task.conversation_id && (WRITER_TASKS.has(candidate.type) || WRITER_TASKS.has(task.type))) return 'A aguardar exclusividade da conversa'
  }
  return ''
}

function compareDueTasks(a: ChatAgentTask, b: ChatAgentTask) {
  return a.priority - b.priority || a.created_at.localeCompare(b.created_at)
}

function compareScheduledTasks(a: ChatAgentTask, b: ChatAgentTask) {
  return Date.parse(a.not_before) - Date.parse(b.not_before) || compareDueTasks(a, b)
}

function taskTypeLabel(type: string) { return TASK_LABELS[type] || type.replaceAll('_', ' ') }

function workerLabel(owner: string) {
  const value = String(owner || '').trim()
  const id = extractWorkerId(value)
  return id ? `Worker ${id.replace('worker-', '')}` : value || 'Por atribuir'
}

function assignmentLabel(task: ChatAgentTask, disposition: TaskDisposition) {
  const assigned = task.assigned_worker ? `${workerLabel(task.assigned_worker)}${task.keep_flowing ? ' · Keep flowing temporário' : ''}` : ''
  if (disposition === 'scheduled') return assigned || 'Atribuição futura'
  if (disposition === 'guarded') return assigned || 'Atribuição protegida'
  if (disposition === 'blocked') return assigned || 'Sem atribuição'
  return task.lease_owner ? workerLabel(task.lease_owner) : assigned || 'Por atribuir'
}

function statusLabelForWorker(worker: DesktopAgentRuntimeAgent) {
  if (worker.draining) return 'a terminar'
  if (worker.status === 'running' || worker.status === 'claimed') return 'ocupado'
  if (worker.status === 'error') return 'com erro'
  return 'disponível'
}

function statusLabel(status: string, disposition: TaskDisposition) {
  if (status === 'RUNNING') return 'Em execução'
  if (status === 'LEASED') return 'A iniciar'
  if (disposition === 'scheduled') return 'Agendada'
  if (disposition === 'guarded') return 'Protegida'
  if (disposition === 'blocked') return 'Sem tentativas'
  return 'Por executar'
}

function timeLabel(value?: string) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function relativeMoment(value?: string) {
  const timestamp = Date.parse(String(value || ''))
  if (!Number.isFinite(timestamp)) return '—'
  return relativeAge(timestamp, timestamp > Date.now())
}

function relativeAge(value: string | number, future = false) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(timestamp)) return '—'
  const seconds = Math.max(0, Math.round(Math.abs(Date.now() - timestamp) / 1000))
  const prefix = future ? 'em ' : 'há '
  if (seconds < 60) return `${prefix}${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${prefix}${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${prefix}${hours}h ${minutes % 60}m`
  return `${prefix}${Math.floor(hours / 24)}d ${hours % 24}h`
}

function formatPayload(payload: unknown) {
  if (payload === undefined || payload === null) return 'Payload: —'
  try { return `Payload\n${JSON.stringify(payload, null, 2)}` } catch { return 'Payload: indisponível' }
}

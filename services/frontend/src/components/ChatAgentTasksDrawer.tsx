import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChatAgentTask } from '../types'
import { api } from '../lib/api'
import { Icon } from './Icon'

const RUNNING = new Set(['LEASED', 'RUNNING'])
const QUEUED = new Set(['PENDING', 'WAITING'])
const REFRESH_MS = 5_000

export function ChatAgentTasksDrawer({ onClose, onError }: { onClose: () => void; onError?: (message: string) => void }) {
  const [tasks, setTasks] = useState<ChatAgentTask[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState(Date.now())

  const refresh = useCallback(async () => {
    try {
      const result = await api.chatAgentTasks(true)
      setTasks(Array.isArray(result.tasks) ? result.tasks : [])
      setRefreshedAt(Date.now())
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Não foi possível carregar as tarefas')
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const running = useMemo(() => tasks.filter((task) => RUNNING.has(task.status)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [tasks])
  const queued = useMemo(() => tasks.filter((task) => QUEUED.has(task.status)).sort(compareQueueTasks), [tasks])

  return <section className="chat-agent-tasks-drawer" aria-label="Tarefas do runtime ChatGPT">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Runtime ChatGPT</span><strong>Tarefas</strong></div><div className="agent-runtime-heading-actions"><button type="button" className="agent-drawer-icon" onClick={() => void refresh()} aria-label="Atualizar tarefas"><Icon name="refresh" size={13}/></button><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar tarefas"><Icon name="close" size={13}/></button></div></header>
    <div className="chat-agent-tasks-summary"><span><b>{running.length}</b> em execução</span><span><b>{queued.length}</b> na fila</span><small>Atualizado {relativeAge(refreshedAt)}</small></div>
    <div className="chat-agent-tasks-body">
      {loading ? <div className="agent-drawer-empty">A carregar fila durável…</div> : !tasks.length ? <div className="agent-drawer-empty"><strong>Sem tarefas ativas.</strong><span>A fila e os Workers estão livres neste momento.</span></div> : <>
        <TaskSection title="Em execução" tasks={running} empty="Nenhum Worker está a executar uma tarefa."/>
        <TaskSection title="Fila" tasks={queued} empty="Nenhuma tarefa está à espera."/>
      </>}
    </div>
  </section>
}

function TaskSection({ title, tasks, empty }: { title: string; tasks: ChatAgentTask[]; empty: string }) {
  return <section className="chat-agent-task-section"><header><strong>{title}</strong><span>{tasks.length}</span></header>{tasks.length ? <div className="chat-agent-task-list">{tasks.map((task) => <TaskCard key={task.task_id} task={task}/>)}</div> : <p>{empty}</p>}</section>
}

function TaskCard({ task }: { task: ChatAgentTask }) {
  const running = RUNNING.has(task.status)
  const waiting = task.status === 'WAITING'
  const next = waiting && Date.parse(task.not_before) > Date.now() ? `Próxima tentativa ${timeLabel(task.not_before)} · ${relativeAge(task.not_before, true)}` : ''
  return <article className={`chat-agent-task-card ${task.status.toLowerCase()}`}>
    <div className="chat-agent-task-heading"><div><span className={`agent-runtime-dot ${running ? (task.status === 'RUNNING' ? 'running' : 'claimed') : 'loading'}`} aria-hidden="true"/><strong>{task.type}</strong></div><span>{statusLabel(task.status)}</span></div>
    <div className="chat-agent-task-worker"><Icon name="agent" size={12}/><b>{workerLabel(task.lease_owner)}</b><small>{running ? `lease até ${timeLabel(task.lease_expires_at)}` : next || 'A aguardar disponibilidade'}</small></div>
    <dl>
      <div><dt>Entrou na fila</dt><dd>{timeLabel(task.created_at)} · {relativeAge(task.created_at)}</dd></div>
      <div><dt>Último trabalho</dt><dd>{statusLabel(task.status)} · {timeLabel(task.updated_at)} · {relativeAge(task.updated_at)}</dd></div>
      <div><dt>Tentativa</dt><dd>{task.attempt}/{task.max_attempts} · prioridade {task.priority}</dd></div>
      <div><dt>Task</dt><dd title={task.task_id}>{task.task_id}</dd></div>
      <div><dt>Request</dt><dd title={task.request_id}>{task.request_id || '—'}</dd></div>
      <div><dt>Chat</dt><dd title={task.chat_id}>{task.chat_id || '—'}</dd></div>
      <div><dt>Lineage</dt><dd title={task.root_request_id}>{task.root_request_id || '—'}</dd></div>
    </dl>
    {task.last_error ? <div className="chat-agent-task-error"><Icon name="bell" size={12}/><span>{task.last_error}</span></div> : null}
    <details className="chat-agent-task-details"><summary>Detalhes técnicos</summary><dl>
      <div><dt>Project</dt><dd title={task.project_id}>{task.project_id || '—'}</dd></div>
      <div><dt>Session</dt><dd title={task.session_id}>{task.session_id || '—'}</dd></div>
      <div><dt>Conversation</dt><dd title={task.conversation_id}>{task.conversation_id || '—'}</dd></div>
      <div><dt>Parent task</dt><dd title={task.parent_task_id}>{task.parent_task_id || '—'}</dd></div>
      <div><dt>Dedupe</dt><dd title={task.dedupe_key}>{task.dedupe_key || '—'}</dd></div>
      <div><dt>Lease owner</dt><dd title={task.lease_owner}>{task.lease_owner || '—'}</dd></div>
      <div><dt>Not before</dt><dd>{timeLabel(task.not_before)}</dd></div>
    </dl><pre>{formatPayload(task.payload)}</pre></details>
  </article>
}

function compareQueueTasks(a: ChatAgentTask, b: ChatAgentTask) {
  const due = Date.now()
  const aDue = Date.parse(a.not_before) <= due ? 0 : 1
  const bDue = Date.parse(b.not_before) <= due ? 0 : 1
  return aDue - bDue || a.priority - b.priority || a.created_at.localeCompare(b.created_at)
}

function workerLabel(owner: string) {
  const value = String(owner || '').trim()
  const match = value.match(/(?:^|:)worker-(\d+)$/)
  return match ? `Worker ${match[1]}` : value || 'Por atribuir'
}

function statusLabel(status: string) {
  if (status === 'RUNNING') return 'Em execução'
  if (status === 'LEASED') return 'A iniciar'
  if (status === 'WAITING') return 'Agendada'
  return 'Na fila'
}

function timeLabel(value?: string) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
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

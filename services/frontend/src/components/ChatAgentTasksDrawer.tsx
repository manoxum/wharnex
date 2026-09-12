import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChatAgentTask } from '../types'
import { api } from '../lib/api'
import { Icon } from './Icon'

const RUNNING = new Set(['LEASED', 'RUNNING'])
const QUEUED = new Set(['PENDING', 'WAITING'])
const REFRESH_MS = 5_000
const TASK_LABELS: Record<string, string> = {
  BOT_WRITE: 'Enviar pedido', RECOVERY_WRITE: 'Enviar correção', AWAIT_RESPONSE: 'Aguardar resposta',
  TITLE_DISCOVER: 'Ler título', TITLE_GENERATE_TEMP: 'Gerar título', TITLE_AWAIT: 'Aguardar título',
  ORGANIZE_CHAT: 'Organizar chat', RENAME_CHAT: 'Renomear chat', ARCHIVE_CHAT: 'Arquivar chat',
  DELETE_CHAT: 'Eliminar chat', DELETE_BUNDLE: 'Limpar bundle', DELETE_TEMP_CHAT: 'Limpar chat temporário',
}

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
        <TaskSection title="Fila" tasks={queued} empty="Nenhuma tarefa está à espera." showPosition/>
      </>}
    </div>
  </section>
}

function TaskSection({ title, tasks, empty, showPosition = false }: { title: string; tasks: ChatAgentTask[]; empty: string; showPosition?: boolean }) {
  return <section className="chat-agent-task-section"><header><strong>{title}</strong><span>{tasks.length}</span></header>{tasks.length ? <div className="chat-agent-task-list">{tasks.map((task, index) => <TaskCard key={task.task_id} task={task} queuePosition={showPosition ? index + 1 : undefined}/>)}</div> : <p>{empty}</p>}</section>
}

function TaskCard({ task, queuePosition }: { task: ChatAgentTask; queuePosition?: number }) {
  const running = RUNNING.has(task.status)
  const waiting = task.status === 'WAITING'
  const schedule = running
    ? `Lease até ${timeLabel(task.lease_expires_at)}`
    : waiting && Date.parse(task.not_before) > Date.now()
      ? `Próxima tentativa ${timeLabel(task.not_before)} · ${relativeAge(task.not_before, true)}`
      : 'A aguardar disponibilidade'

  return <article className={`chat-agent-task-card ${task.status.toLowerCase()}`}>
    <div className="chat-agent-task-heading">
      <div className="chat-agent-task-identity"><span className={`agent-runtime-dot ${running ? (task.status === 'RUNNING' ? 'running' : 'claimed') : 'loading'}`} aria-hidden="true"/><div><strong>{taskTypeLabel(task.type)}</strong><code>{task.type}</code></div></div>
      <span className="chat-agent-task-state">{statusLabel(task.status)}</span>
    </div>
    <div className="chat-agent-task-worker"><span><Icon name="agent" size={13}/><b>{workerLabel(task.lease_owner)}</b></span><small title={schedule}>{schedule}</small>{queuePosition ? <em aria-label={`Posição ${queuePosition} na fila`}>#{String(queuePosition).padStart(2, '0')}</em> : null}</div>
    <div className="chat-agent-task-metrics" aria-label="Resumo da tarefa">
      <TaskMetric label="Na fila" value={relativeAge(task.created_at)}/>
      <TaskMetric label="Atividade" value={relativeAge(task.updated_at)}/>
      <TaskMetric label="Tentativa" value={`${task.attempt}/${task.max_attempts}`}/>
    </div>
    {task.last_error ? <div className="chat-agent-task-error"><Icon name="bell" size={13}/><span>{task.last_error}</span></div> : null}
    <details className="chat-agent-task-details"><summary><span>Ver informações completas</span></summary><div className="chat-agent-task-detail-grid">
      <TaskDetails title="Execução" rows={[
        ['Entrou na fila', `${timeLabel(task.created_at)} · ${relativeAge(task.created_at)}`],
        ['Último trabalho', `${statusLabel(task.status)} · ${timeLabel(task.updated_at)} · ${relativeAge(task.updated_at)}`],
        ['Tentativa', `${task.attempt}/${task.max_attempts} · prioridade ${task.priority}`],
        ['Not before', timeLabel(task.not_before)],
      ]}/>
      <TaskDetails title="Identificadores" rows={[
        ['Task', task.task_id], ['Request', task.request_id || '—'], ['Chat', task.chat_id || '—'], ['Lineage', task.root_request_id || '—'],
        ['Project', task.project_id || '—'], ['Session', task.session_id || '—'], ['Conversation', task.conversation_id || '—'],
        ['Parent task', task.parent_task_id || '—'], ['Dedupe', task.dedupe_key || '—'], ['Lease owner', task.lease_owner || '—'],
      ]}/>
      <pre>{formatPayload(task.payload)}</pre>
    </div></details>
  </article>
}

function TaskMetric({ label, value }: { label: string; value: string }) {
  return <span><small>{label}</small><b>{value}</b></span>
}

function TaskDetails({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <section><strong>{title}</strong><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl></section>
}

function compareQueueTasks(a: ChatAgentTask, b: ChatAgentTask) {
  const due = Date.now()
  const aDue = Date.parse(a.not_before) <= due ? 0 : 1
  const bDue = Date.parse(b.not_before) <= due ? 0 : 1
  return aDue - bDue || a.priority - b.priority || a.created_at.localeCompare(b.created_at)
}

function taskTypeLabel(type: string) { return TASK_LABELS[type] || type.replaceAll('_', ' ') }

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

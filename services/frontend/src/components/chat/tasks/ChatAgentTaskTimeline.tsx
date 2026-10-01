import { useEffect, useState } from 'react'
import type { ChatAgentTaskEvent } from '../../../types'
import { api } from '../../../lib/transport/http/api'
import { Icon } from '../../presentation/chrome/Icon'

const EVENT_LABELS: Record<string, string> = {
  'chatgpt.recovery_reload': 'Recarregou a conversa',
  'chatgpt.recovery_keep_continue': 'Enviou "keep continue"',
  'chatgpt.continuation_sent': 'Enviou continuação',
  'chatgpt.bundle_validated': 'Bundle validado',
  'chatgpt.bundle_rejected': 'Bundle rejeitado',
  'chatgpt.human_action_required': 'Pediu atenção humana',
}

// Read-only timeline for the durable per-task decision ledger (adr/ADR-0064):
// every recovery reload, keep-continue wake-up, bundle validated/rejected and
// human escalation recorded against one Main Request's task. Fetched lazily
// (only once `enabled`, i.e. the operator actually opened "Detalhes") so the
// list view's 5s refresh never fans out into one request per visible task.
export function ChatAgentTaskTimeline({ taskId, enabled }: { taskId: string; enabled: boolean }) {
  const [events, setEvents] = useState<ChatAgentTaskEvent[]>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || events !== undefined) return
    let cancelled = false
    api.chatAgentTaskEvents(taskId)
      .then((result) => { if (!cancelled) setEvents(Array.isArray(result.events) ? result.events : []) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Não foi possível carregar o histórico') })
    return () => { cancelled = true }
  }, [enabled, events, taskId])

  if (!enabled) return null
  if (error) return <section className="chat-agent-task-timeline"><strong>Histórico</strong><p className="chat-agent-task-timeline-error"><Icon name="bell" size={13}/> {error}</p></section>
  if (events === undefined) return <section className="chat-agent-task-timeline"><strong>Histórico</strong><p>A carregar…</p></section>
  if (!events.length) return <section className="chat-agent-task-timeline"><strong>Histórico</strong><p>Nenhuma decisão registada para esta tarefa.</p></section>

  return <section className="chat-agent-task-timeline">
    <strong>Histórico</strong>
    <ol>
      {events.map((event) => <li key={event.id}>
        <div className="chat-agent-task-timeline-row">
          <span>{EVENT_LABELS[event.type] || event.type}</span>
          <time dateTime={event.occurred_at}>{formatTimestamp(event.occurred_at)}</time>
        </div>
        {hasVisibleData(event.data) ? <pre>{JSON.stringify(event.data, null, 2)}</pre> : null}
      </li>)}
    </ol>
  </section>
}

function hasVisibleData(data: Record<string, unknown>) {
  return data && Object.keys(data).length > 0
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

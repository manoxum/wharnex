import { useEffect, useMemo, useState } from 'react'
import type { Session } from '../types'
import { api } from '../lib/api'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { collectExecutionActivities, collectPlanActivities, executionEventsFromResult, loadProjectSessions, sessionForPlan, type ProjectSessionActivity } from '../lib/projectActivity'
import { Icon } from './Icon'
import { PlanView, TerminalView } from './Inspector'

export type ProjectActivityKind = 'plans' | 'executions'

export function ProjectActivityDrawer({ kind, chats, currentSession, activeChatId, onClose }: {
  kind: ProjectActivityKind
  chats: WorkspaceChat[]
  currentSession: Session
  activeChatId: string
  onClose: () => void
}) {
  const [remoteSessions, setRemoteSessions] = useState<Record<string, Session>>({})
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const remoteSessionKey = JSON.stringify([...new Set(chats.filter((chat) => chat.id !== activeChatId).map((chat) => chat.sessionId))].sort())

  useEffect(() => {
    let cancelled = false
    const sessionIds = JSON.parse(remoteSessionKey) as string[]
    if (!sessionIds.length) { setRemoteSessions({}); setLoading(false); setError(''); return }
    setLoading(true); setError('')
    void loadProjectSessions(sessionIds, api.getSession)
      .then((result) => {
        if (cancelled) return
        setRemoteSessions(result.sessions)
        if (result.failed) setError(`Não foi possível carregar ${result.failed} ${result.failed === 1 ? 'sessão' : 'sessões'} do histórico.`)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [remoteSessionKey])

  const sessions = useMemo(() => chats.flatMap((chat): ProjectSessionActivity[] => {
    if (chat.id === activeChatId) return [{ chat, session: currentSession }]
    const remote = remoteSessions[chat.sessionId]
    return remote ? [{ chat, session: remote }] : []
  }), [activeChatId, chats, currentSession, remoteSessions])
  const plans = useMemo(() => collectPlanActivities(sessions), [sessions])
  const executions = useMemo(() => collectExecutionActivities(sessions), [sessions])
  const entries = kind === 'plans' ? plans : executions
  const chosen = entries.find((item) => item.id === selected) || entries[0]

  useEffect(() => {
    if (entries.length && !entries.some((item) => item.id === selected)) setSelected(entries[0].id)
  }, [entries, selected])

  return <section className="project-activity-drawer" aria-label={kind === 'plans' ? 'Planos do projeto' : 'Execuções do projeto'}>
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Projeto inteiro</span><strong>{kind === 'plans' ? 'Planos' : 'Execuções'}</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar drawer"><Icon name="close" size={13}/></button></header>
    {!entries.length && loading ? <div className="agent-drawer-empty">A carregar atividade…</div> : !entries.length ? <div className="agent-drawer-empty">{error || (kind === 'plans' ? 'Nenhum plano disponível nos chats deste projeto.' : 'Nenhuma execução disponível nos chats deste projeto.')}</div> : <div className="project-activity-layout">
      <div className="project-activity-list" role="list">
        {loading ? <div className="project-activity-status">A carregar restante atividade…</div> : null}
        {error ? <div className="project-activity-status warning">{error}</div> : null}
        {entries.map((item) => {
          const statusClass = 'execution' in item ? (item.execution.success ? 'status-success' : 'status-failed') : ''
          return <button key={item.id} type="button" role="listitem" className={[item.id === chosen?.id ? 'active' : '', statusClass].filter(Boolean).join(' ')} onClick={() => setSelected(item.id)}>
          <span>{item.chatTitle}</span>
          <strong>{'plan' in item ? item.plan.summary : item.execution.plan_id}</strong>
          <small>{'plan' in item ? item.label : (item.execution.success ? 'Concluída' : 'Falhou')} · {formatDate(item.timestamp)}</small>
        </button>
        })}
      </div>
      <div className="project-activity-detail">
        {chosen && kind === 'plans' && 'plan' in chosen ? <PlanView session={sessionForPlan(chosen)} /> : null}
        {chosen && kind === 'executions' && 'execution' in chosen ? <>
          <div className="project-execution-meta"><strong>{chosen.execution.plan_id}</strong><span>{chosen.chatTitle} · {chosen.execution.success ? 'Concluída' : 'Falhou'} · {formatDate(chosen.execution.started_at)} → {formatDate(chosen.execution.completed_at)}</span>{chosen.execution.warnings?.map((warning) => <small key={warning}>{warning}</small>)}{chosen.execution.error ? <small>{chosen.execution.error}</small> : null}</div>
          <TerminalView events={executionEventsFromResult(chosen.execution, chosen.session.id)} />
        </> : null}
      </div>
    </div>}
  </section>
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

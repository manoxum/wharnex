import { useEffect, useMemo, useState } from 'react'
import type { HarnessEvent, Session } from '../types'
import { api } from '../lib/api'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { collectExecutionActivities, collectPlanActivities, executionAuditEvents, executionEventsFromResult, filterAuditEvents, loadProjectSessions, sessionForPlan, type ProjectSessionActivity } from '../lib/projectActivity'
import { Icon } from './Icon'
import { ContentSkeleton } from './Skeleton'
import { PlanView, TerminalView } from './Inspector'

export type ProjectActivityKind = 'plans' | 'executions'

export function ProjectActivityDrawer({ kind, chats, currentSession, activeChatId, activeEvents, onClose }: {
  kind: ProjectActivityKind
  chats: WorkspaceChat[]
  currentSession: Session
  activeChatId: string
  activeEvents: HarnessEvent[]
  onClose: () => void
}) {
  const [remoteSessions, setRemoteSessions] = useState<Record<string, Session>>({})
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [eventHistory, setEventHistory] = useState<Record<string, { events: HarnessEvent[]; total: number; truncated: boolean }>>({})
  const [eventHistoryError, setEventHistoryError] = useState<Record<string, string>>({})
  const [eventHistoryLoading, setEventHistoryLoading] = useState('')
  const [logScope, setLogScope] = useState<'execution' | 'session'>('execution')
  const [logQuery, setLogQuery] = useState('')
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
  // The durable ledger is fetched for every listed session, not only the chosen
  // one: it is what the lists themselves are built from now, because the session
  // snapshot keeps a single plan and a single execution and clears both across
  // lifecycle transitions. Loading it lazily would have shown an empty history
  // until something was selected, which is the reset the operator reported.
  const ledgerKey = JSON.stringify(sessions.map(({ chat, session }) => [chat.id, session.id]))
  useEffect(() => {
    let cancelled = false
    const pairs = JSON.parse(ledgerKey) as [string, string][]
    const missing = pairs.filter(([, sessionId]) => !eventHistory[sessionId] && !eventHistoryError[sessionId])
    if (!missing.length) return
    void Promise.all(missing.map(async ([, sessionId]) => {
      try {
        const snapshot = await api.eventHistory(sessionId)
        if (!cancelled) setEventHistory((current) => ({ ...current, [sessionId]: snapshot }))
      } catch {
        if (!cancelled) setEventHistoryError((current) => ({ ...current, [sessionId]: 'Histórico de auditoria indisponível; a mostrar apenas o resultado resumido da execução.' }))
      }
    }))
    return () => { cancelled = true }
  }, [eventHistory, eventHistoryError, ledgerKey])

  const ledger = useMemo(() => {
    const byChat: Record<string, HarnessEvent[]> = {}
    for (const { chat, session } of sessions) {
      const persisted = eventHistory[session.id]?.events || []
      const live = chat.id === activeChatId ? activeEvents : []
      const merged = new Map<string, HarnessEvent>()
      for (const event of [...persisted, ...live]) merged.set(event.id, event)
      byChat[chat.id] = [...merged.values()]
    }
    return byChat
  }, [activeChatId, activeEvents, eventHistory, sessions])

  const plans = useMemo(() => collectPlanActivities(sessions, ledger), [ledger, sessions])
  const executions = useMemo(() => collectExecutionActivities(sessions, ledger), [ledger, sessions])
  const entries = kind === 'plans' ? plans : executions
  const chosen = entries.find((item) => item.id === selected) || entries[0]

  useEffect(() => {
    if (entries.length && !entries.some((item) => item.id === selected)) setSelected(entries[0].id)
  }, [entries, selected])

  const chosenExecution = chosen && 'execution' in chosen ? chosen : undefined
  useEffect(() => {
    if (!chosenExecution || eventHistory[chosenExecution.session.id] || eventHistoryError[chosenExecution.session.id]) return
    let cancelled = false
    const sessionID = chosenExecution.session.id
    setEventHistoryLoading(sessionID)
    void api.eventHistory(sessionID)
      .then((snapshot) => { if (!cancelled) setEventHistory((current) => ({ ...current, [sessionID]: snapshot })) })
      .catch(() => { if (!cancelled) setEventHistoryError((current) => ({ ...current, [sessionID]: 'Histórico de auditoria indisponível; a mostrar apenas o resultado resumido da execução.' })) })
      .finally(() => { if (!cancelled) setEventHistoryLoading((current) => current === sessionID ? '' : current) })
    return () => { cancelled = true }
  }, [chosenExecution, eventHistory, eventHistoryError])

  const selectedHistory = useMemo(() => {
    if (!chosenExecution) return []
    const persisted = eventHistory[chosenExecution.session.id]?.events || []
    const live = chosenExecution.chatId === activeChatId ? activeEvents : []
    const merged = new Map<string, HarnessEvent>()
    for (const event of [...persisted, ...live]) merged.set(event.id, event)
    return [...merged.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
  }, [activeChatId, activeEvents, chosenExecution, eventHistory])
  const scopedHistory = useMemo(() => chosenExecution && logScope === 'execution' ? executionAuditEvents(selectedHistory, chosenExecution) : selectedHistory, [chosenExecution, logScope, selectedHistory])
  const searchedHistory = useMemo(() => filterAuditEvents(scopedHistory, logQuery), [logQuery, scopedHistory])
  const fallbackEvents = useMemo(() => chosenExecution ? executionEventsFromResult(chosenExecution.execution, chosenExecution.session.id) : [], [chosenExecution])
  const visibleEvents = searchedHistory.length || logQuery ? searchedHistory : (scopedHistory.length ? scopedHistory : fallbackEvents)
  const failureCount = visibleEvents.filter((event) => /failed|error|blocked|rejected|exhausted/i.test(event.type) || event.data.success === false).length
  const commandCount = new Set(visibleEvents.filter((event) => event.type.startsWith('command.')).map((event) => String(event.data.run_id || event.id))).size

  return <section className="project-activity-drawer" aria-label={kind === 'plans' ? 'Planos do projeto' : 'Execuções do projeto'}>
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Projeto inteiro</span><strong>{kind === 'plans' ? 'Planos' : 'Execuções'}</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar drawer"><Icon name="close" size={13}/></button></header>
    {!entries.length && loading ? <ContentSkeleton label="A carregar atividade do projeto" rows={6}/> : !entries.length ? <div className="agent-drawer-empty">{error || (kind === 'plans' ? 'Nenhum plano disponível nos chats deste projeto.' : 'Nenhuma execução disponível nos chats deste projeto.')}</div> : <div className="project-activity-layout">
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
        {chosenExecution && kind === 'executions' ? <>
          <div className="project-execution-meta"><strong>{chosenExecution.execution.plan_id}</strong><span>{chosenExecution.chatTitle} · {chosenExecution.execution.success ? 'Concluída' : 'Falhou'} · {formatDate(chosenExecution.execution.started_at)} → {formatDate(chosenExecution.execution.completed_at)}</span>{chosenExecution.requestId ? <code>{chosenExecution.requestId}</code> : null}{chosenExecution.execution.warnings?.map((warning) => <small key={warning}>{warning}</small>)}{chosenExecution.execution.error ? <small>{chosenExecution.execution.error}</small> : null}</div>
          <div className="project-log-toolbar">
            <div className="project-log-stats"><span><b>{visibleEvents.length}</b> eventos</span><span><b>{commandCount}</b> comandos</span><span className={failureCount ? 'danger' : ''}><b>{failureCount}</b> falhas</span></div>
            <div className="project-log-scope" aria-label="Âmbito dos logs"><button type="button" className={logScope === 'execution' ? 'active' : ''} onClick={() => setLogScope('execution')}>Execução</button><button type="button" className={logScope === 'session' ? 'active' : ''} onClick={() => setLogScope('session')}>Sessão</button></div>
            <input type="search" value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Filtrar evento, comando, erro ou request…" aria-label="Filtrar logs" />
          </div>
          {eventHistoryLoading === chosenExecution.session.id ? <ContentSkeleton label="A carregar histórico de auditoria" rows={4} compact/> : null}
          {eventHistory[chosenExecution.session.id]?.truncated ? <div className="project-log-notice warning">A sessão tem {eventHistory[chosenExecution.session.id].total} eventos; são mostrados os 2000 mais recentes.</div> : null}
          {eventHistoryError[chosenExecution.session.id] ? <div className="project-log-notice warning">{eventHistoryError[chosenExecution.session.id]}</div> : null}
          {logQuery && !visibleEvents.length ? <div className="agent-drawer-empty">Nenhum log corresponde ao filtro atual.</div> : <TerminalView key={`${chosenExecution.id}:${logScope}`} events={visibleEvents} />}
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

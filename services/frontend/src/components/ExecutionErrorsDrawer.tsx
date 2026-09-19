import { useEffect, useMemo, useState } from 'react'
import type { ExecutionErrorRecord, Session } from '../types'
import type { WorkspaceChat } from '../lib/workspaceMemory'
import { api } from '../lib/api'
import { Icon } from './Icon'

type Filter = 'all' | 'open' | 'resolved'
type ErrorView = ExecutionErrorRecord & { chatTitle: string }

export function ExecutionErrorsDrawer({ chats, currentSession, activeChatId, onClose }: {
  chats: WorkspaceChat[]
  currentSession: Session
  activeChatId: string
  onClose: () => void
}) {
  const [items, setItems] = useState<ErrorView[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const sessionKey = JSON.stringify([...new Map(chats.map((chat) => [chat.sessionId, chat])).values()].map((chat) => [chat.sessionId, chat.title]))
  const activeTitle = chats.find((chat) => chat.id === activeChatId)?.title || 'Chat atual'

  useEffect(() => {
    let cancelled = false
    const pairs = JSON.parse(sessionKey) as [string, string][]
    if (!pairs.some(([sessionId]) => sessionId === currentSession.id)) {
      pairs.push([currentSession.id, activeTitle])
    }
    setLoading(true); setLoadError('')
    void Promise.all(pairs.map(async ([sessionId, chatTitle]) => {
      try {
        const result = await api.executionErrors(sessionId)
        return { records: result.errors.map((record) => ({ ...record, chatTitle })), failed: false }
      } catch { return { records: [] as ErrorView[], failed: true } }
    })).then((results) => {
      if (cancelled) return
      const next = results.flatMap((result) => result.records).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      setItems(next)
      const failed = results.filter((result) => result.failed).length
      setLoadError(failed ? `Não foi possível carregar ${failed} ${failed === 1 ? 'sessão' : 'sessões'} do histórico.` : '')
      setSelected((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id || '')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeTitle, currentSession.id, currentSession.last_execution?.completed_at, sessionKey])

  const totals = useMemo(() => ({
    total: items.length,
    open: items.filter((item) => item.status !== 'resolved').length,
    resolved: items.filter((item) => item.status === 'resolved').length,
    kinds: new Set(items.map((item) => item.failure_kind).filter(Boolean)).size,
  }), [items])
  const distribution = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.failure_kind || 'não classificado', (counts.get(item.failure_kind || 'não classificado') || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [items])
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return items.filter((item) => (filter === 'all' || item.status === filter) && (!needle || [item.error, item.cause, item.failure_kind, item.request_id, item.root_request_id, item.plan_id, item.chatTitle].join(' ').toLocaleLowerCase().includes(needle)))
  }, [filter, items, query])
  const chosen = visible.find((item) => item.id === selected) || visible[0]

  return <section className="execution-errors-drawer" aria-label="Histórico estruturado de erros de execução">
    <header className="agent-drawer-heading"><div><span className="panel-kicker">Projeto inteiro</span><strong>Erros de execução</strong></div><button type="button" className="agent-drawer-icon" onClick={onClose} aria-label="Fechar drawer"><Icon name="close" size={13}/></button></header>
    <div className="execution-errors-summary" aria-label="Resumo de ocorrências">
      <span><b>{totals.total}</b><small>Total</small></span><span className={totals.open ? 'danger' : ''}><b>{totals.open}</b><small>Abertas</small></span><span><b>{totals.resolved}</b><small>Resolvidas</small></span><span><b>{totals.kinds}</b><small>Tipos</small></span>
    </div>
    <div className="execution-errors-toolbar">
      <div className="execution-errors-filters" role="tablist" aria-label="Estado das ocorrências">{(['all', 'open', 'resolved'] as Filter[]).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'Todas' : value === 'open' ? 'Abertas' : 'Resolvidas'}</button>)}</div>
      <label><Icon name="search" size={13}/><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Erro, causa, request, plano…" aria-label="Pesquisar erros de execução"/></label>
    </div>
    {distribution.length ? <div className="execution-errors-distribution" aria-label="Distribuição por tipo de falha">{distribution.map(([kind, count]) => <div key={kind}><span>{kind}</span><i><b style={{ width: `${Math.max(8, Math.round((count / totals.total) * 100))}%` }}/></i><strong>{count}</strong></div>)}</div> : null}
    {loadError ? <div className="project-activity-status warning">{loadError}</div> : null}
    {loading && !items.length ? <div className="agent-drawer-empty">A carregar ocorrências…</div> : !visible.length ? <div className="agent-drawer-empty">{items.length ? 'Nenhuma ocorrência corresponde aos filtros.' : 'Ainda não existem erros de execução registados.'}</div> : <div className="execution-errors-layout">
      <div className="execution-errors-list" role="list">{visible.map((item) => <button key={item.id} type="button" role="listitem" className={`${chosen?.id === item.id ? 'active ' : ''}${item.status === 'resolved' ? 'resolved' : 'open'}`} onClick={() => setSelected(item.id)}><span><b>{item.status === 'resolved' ? 'Resolvida' : 'Aberta'}</b>{item.failure_kind || 'não classificado'}</span><strong>{item.error || item.cause || 'Falha de execução'}</strong><small>{item.chatTitle} · {formatDate(item.occurred_at)}</small></button>)}</div>
      {chosen ? <ErrorDetail item={chosen}/> : null}
    </div>}
  </section>
}

function ErrorDetail({ item }: { item: ErrorView }) {
  return <div className="execution-error-detail">
    <div className="execution-error-heading"><div><span className={`execution-error-status ${item.status === 'resolved' ? 'resolved' : 'open'}`}>{item.status === 'resolved' ? 'Resolvida' : 'Aberta'}</span><strong>{item.error || 'Falha de execução'}</strong><small>{item.chatTitle} · {formatDate(item.occurred_at)}</small></div>{item.status_code !== undefined ? <code>exit {item.status_code}</code> : null}</div>
    <dl className="execution-error-meta"><Meta label="Tipo" value={item.failure_kind || 'não classificado'}/><Meta label="Request" value={item.request_id}/><Meta label="Request raiz" value={item.root_request_id}/><Meta label="Plano" value={item.plan_id}/><Meta label="Etapa" value={item.stage}/></dl>
    {item.cause ? <section><h4>Causa</h4><p>{item.cause}</p></section> : null}
    <section><h4>Logs da ocorrência <span>{item.logs.length}</span></h4>{item.logs.length ? <div className="execution-error-logs">{item.logs.map((log, index) => <article key={`${log.operation_id || log.argv?.join(' ') || log.kind}-${index}`}><header><b>{log.kind === 'command' ? 'Comando' : log.operation_type || 'Operação interativa'}</b>{log.exit_code !== undefined ? <code>exit {log.exit_code}</code> : null}{log.duration_ms ? <small>{log.duration_ms} ms</small> : null}</header>{log.argv?.length ? <pre>$ {log.argv.join(' ')}</pre> : null}{log.cwd ? <small>{log.cwd}</small> : null}{log.stderr ? <pre className="danger">{log.stderr}</pre> : null}{log.error ? <pre className="danger">{log.error}</pre> : null}{log.stdout ? <pre>{log.stdout}</pre> : null}{log.output ? <pre>{log.output}</pre> : null}</article>)}</div> : <p className="muted">Sem logs específicos anexados.</p>}</section>
    {item.gpt_solution ? <section className="execution-error-solution"><h4>Solução aplicada pelo GPT</h4><strong>{item.gpt_solution.summary || item.gpt_solution.plan_id}</strong><small>{item.gpt_solution.request_id} · {item.gpt_solution.plan_id}</small>{item.gpt_solution.commit_message ? <pre>{item.gpt_solution.commit_message}</pre> : null}{item.resolved_at ? <span>Resolvida em {formatDate(item.resolved_at)}</span> : null}</section> : null}
  </div>
}

function Meta({ label, value }: { label: string; value?: string }) { return value ? <div><dt>{label}</dt><dd>{value}</dd></div> : null }
function formatDate(value?: string) { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date) }

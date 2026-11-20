import { useEffect, useMemo, useState } from 'react'
import type { ExecutionErrorRecord, Session } from '../../../types'
import type { WorkspaceChat } from '../../../lib/chat/history/workspaceMemory'
import { api } from '../../../lib/transport/http/api'
import { interfaceLocale, translate as uiText, formatMessage } from '../../../lib/workspace/localization'
import { IconButton, PanelHeader } from '../../presentation/workbench'
import { ExecutionProblemFilters } from './diagnostics'

type Filter = 'all' | 'open' | 'resolved'
type ErrorView = ExecutionErrorRecord & { chatTitle: string }

export function ExecutionErrorsDrawer({ chats, currentSession, activeChatId, onClose, onSummary, embedded = false }: {
  chats: WorkspaceChat[]; currentSession: Session; activeChatId: string; onClose: () => void
  onSummary?: (count: number | null) => void; embedded?: boolean
}) {
  const [items, setItems] = useState<ErrorView[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const sessionKey = JSON.stringify([...new Map(chats.map((chat) => [chat.sessionId, chat])).values()].map((chat) => [chat.sessionId, chat.title]))
  const activeTitle = chats.find((chat) => chat.id === activeChatId)?.title || uiText('Chat atual')

  useEffect(() => {
    let cancelled = false
    const pairs = JSON.parse(sessionKey) as [string, string][]
    if (!pairs.some(([sessionId]) => sessionId === currentSession.id)) pairs.push([currentSession.id, activeTitle])
    setLoading(true); setLoadError('')
    void Promise.all(pairs.map(async ([sessionId, chatTitle]) => {
      try { return { records: (await api.executionErrors(sessionId)).errors.map((record) => ({ ...record, chatTitle })), failed: false } }
      catch { return { records: [] as ErrorView[], failed: true } }
    })).then((results) => {
      if (cancelled) return
      const next = results.flatMap((result) => result.records).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      setItems(next)
      const failed = results.filter((result) => result.failed).length
      setLoadError(failed ? formatMessage('Não foi possível carregar {count} sessões do histórico.', { count: failed }) : '')
      setSelected((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id || '')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeTitle, currentSession.id, currentSession.last_execution?.completed_at, sessionKey])

  const totals = useMemo(() => ({ total: items.length, open: items.filter((item) => item.status !== 'resolved').length,
    resolved: items.filter((item) => item.status === 'resolved').length,
    kinds: new Set(items.map((item) => item.failure_kind).filter(Boolean)).size }), [items])
  useEffect(() => { onSummary?.(loading || loadError ? null : totals.total) }, [loading, loadError, totals.total, onSummary])
  const distribution = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) { const kind = item.failure_kind || uiText('não classificado'); counts.set(kind, (counts.get(kind) || 0) + 1) }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [items])
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return items.filter((item) => (filter === 'all' || item.status === filter) && (!needle || [item.error, item.cause, item.failure_kind, item.request_id, item.root_request_id, item.plan_id, item.chatTitle].join(' ').toLocaleLowerCase().includes(needle)))
  }, [filter, items, query])
  const chosen = visible.find((item) => item.id === selected) || visible[0]

  return <section className="@container/errors flex h-full min-h-0 flex-col bg-whx-bg text-whx-text" aria-label={uiText('Histórico estruturado de erros de execução')}>
    {!embedded && <PanelHeader title={uiText('Erros de execução')} icon="alert" actions={<IconButton label={uiText('Fechar painel')} icon="close" onClick={onClose}/>}/>}
    {!embedded && <div className="flex min-h-8 shrink-0 items-center gap-4 border-b border-whx-border-soft bg-whx-side px-3 text-[calc(10px*var(--ui-font-scale))] text-whx-faint" aria-label={uiText('Resumo de ocorrências')}>
      <Metric label={uiText('Total')} value={totals.total}/><Metric label={uiText('Abertas')} value={totals.open} danger={totals.open > 0}/><Metric label={uiText('Resolvidas')} value={totals.resolved}/><Metric label={uiText('Tipos')} value={totals.kinds}/>
    </div>}
    <ExecutionProblemFilters filter={filter} onFilter={setFilter} query={query} onQuery={setQuery} totals={totals} distribution={distribution}/>
    {loadError && <div className="border-b border-whx-warning/30 bg-whx-warning/10 px-3 py-2 text-[calc(11px*var(--ui-font-scale))] text-whx-warning" role="status">{loadError}</div>}
    {loading && !items.length ? <Empty text={uiText('A carregar ocorrências…')}/> : !visible.length ? <Empty text={uiText(items.length ? 'Nenhuma ocorrência corresponde aos filtros.' : 'Ainda não existem erros de execução registados.')}/> : <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(180px,34%)_minmax(0,1fr)] @max-[620px]/errors:grid-cols-1 @max-[620px]/errors:grid-rows-[minmax(112px,30%)_minmax(0,1fr)]">
      <div className="min-h-0 overflow-auto border-r border-whx-border-soft bg-whx-side @max-[620px]/errors:border-b @max-[620px]/errors:border-r-0" role="list">{visible.map((item) => {
        const resolved = item.status === 'resolved', active = chosen?.id === item.id
        const selection = resolved ? 'shadow-[inset_2px_0_var(--theme-success)]' : 'shadow-[inset_2px_0_var(--theme-danger)]'
        return <button key={item.id} type="button" role="listitem" aria-current={active ? 'true' : undefined} className={`flex min-h-[60px] w-full flex-col justify-center gap-1 border-0 border-b border-whx-border-soft px-3 py-2 text-left transition-colors ${active ? `bg-whx-selection ${selection}` : 'bg-transparent hover:bg-whx-hover'}`} onClick={() => setSelected(item.id)}>
          <span className="flex min-w-0 items-center gap-2 text-[calc(10px*var(--ui-font-scale))] text-whx-faint"><b className={`shrink-0 font-medium ${resolved ? 'text-whx-success' : 'text-whx-danger'}`}>{uiText(resolved ? 'Resolvida' : 'Aberta')}</b><span className="truncate">{item.failure_kind || uiText('não classificado')}</span></span>
          <strong className="truncate text-[calc(12px*var(--ui-font-scale))] font-medium text-whx-text">{item.error || item.cause || uiText('Falha de execução')}</strong>
          <small className="truncate text-[calc(10px*var(--ui-font-scale))] text-whx-faint">{item.chatTitle} · {formatDate(item.occurred_at)}</small>
        </button>
      })}</div>
      {chosen ? <ErrorDetail item={chosen}/> : null}
    </div>}
  </section>
}

function ErrorDetail({ item }: { item: ErrorView }) {
  const resolved = item.status === 'resolved'
  return <div className="min-h-0 min-w-0 overflow-auto p-3 text-whx-text">
    <div className="flex min-w-0 items-start justify-between gap-3"><div className="grid min-w-0 gap-1"><span className={`w-fit rounded-sm px-1.5 py-0.5 text-[calc(10px*var(--ui-font-scale))] font-medium ${resolved ? 'bg-whx-success/10 text-whx-success' : 'bg-whx-danger/10 text-whx-danger'}`}>{uiText(resolved ? 'Resolvida' : 'Aberta')}</span><strong className="break-words text-[calc(14px*var(--ui-font-scale))] font-semibold leading-snug">{item.error || uiText('Falha de execução')}</strong><small className="text-[calc(11px*var(--ui-font-scale))] text-whx-faint">{item.chatTitle} · {formatDate(item.occurred_at)}</small></div>{item.status_code !== undefined ? <code className="shrink-0 rounded border border-whx-border-soft bg-whx-side px-1.5 py-1 font-mono text-[calc(10px*var(--ui-font-scale))] text-whx-soft">exit {item.status_code}</code> : null}</div>
    <dl className="my-3 grid grid-cols-2 border-y border-whx-border-soft @max-[620px]/errors:grid-cols-1"><Meta label={uiText('Tipo')} value={item.failure_kind || uiText('não classificado')}/><Meta label="Request" value={item.request_id}/><Meta label={uiText('Request raiz')} value={item.root_request_id}/><Meta label={uiText('Plano')} value={item.plan_id}/><Meta label={uiText('Etapa')} value={item.stage}/></dl>
    {item.cause && <section className="mb-3 grid min-w-0 gap-1"><h4 className="m-0 text-[calc(12px*var(--ui-font-scale))] font-semibold">{uiText('Causa')}</h4><p className="m-0 break-words text-[calc(12px*var(--ui-font-scale))] leading-relaxed text-whx-soft">{item.cause}</p></section>}
    <section className="grid min-w-0 gap-2"><h4 className="m-0 flex items-center gap-2 text-[calc(12px*var(--ui-font-scale))] font-semibold">{uiText('Logs da ocorrência')} <span className="font-mono text-[calc(10px*var(--ui-font-scale))] text-whx-faint">{item.logs.length}</span></h4>{item.logs.length ? <div className="grid gap-2">{item.logs.map((log, index) => <article className="grid min-w-0 gap-1.5 border-l-2 border-whx-border-soft bg-whx-side p-2" key={`${log.operation_id || log.argv?.join(' ') || log.kind}-${index}`}>
      <header className="flex items-center gap-2"><b className="text-[calc(11px*var(--ui-font-scale))] font-medium">{uiText(log.kind === 'command' ? 'Comando' : log.operation_type || 'Operação interativa')}</b>{log.exit_code !== undefined && <code className="font-mono text-[calc(10px*var(--ui-font-scale))] text-whx-faint">exit {log.exit_code}</code>}{log.duration_ms && <small className="ml-auto text-[calc(10px*var(--ui-font-scale))] text-whx-faint">{log.duration_ms} ms</small>}</header>
      {log.argv?.length ? <CodeBlock>{`$ ${log.argv.join(' ')}`}</CodeBlock> : null}{log.cwd && <small className="break-all font-mono text-[calc(10px*var(--ui-font-scale))] text-whx-faint">{log.cwd}</small>}{log.stderr && <CodeBlock danger>{log.stderr}</CodeBlock>}{log.error && <CodeBlock danger>{log.error}</CodeBlock>}{log.stdout && <CodeBlock>{log.stdout}</CodeBlock>}{log.output && <CodeBlock>{log.output}</CodeBlock>}
    </article>)}</div> : <p className="m-0 text-[calc(11px*var(--ui-font-scale))] text-whx-faint">{uiText('Sem logs específicos anexados.')}</p>}</section>
    {item.gpt_solution && <section className="mt-3 grid min-w-0 gap-1 border-l-2 border-whx-success bg-whx-success/5 p-2"><h4 className="m-0 text-[calc(12px*var(--ui-font-scale))] font-semibold">{uiText('Solução aplicada pelo GPT')}</h4><strong className="text-[calc(12px*var(--ui-font-scale))]">{item.gpt_solution.summary || item.gpt_solution.plan_id}</strong><small className="break-words text-[calc(10px*var(--ui-font-scale))] text-whx-faint">{item.gpt_solution.request_id} · {item.gpt_solution.plan_id}</small>{item.gpt_solution.commit_message && <CodeBlock>{item.gpt_solution.commit_message}</CodeBlock>}{item.resolved_at && <span className="text-[calc(10px*var(--ui-font-scale))] text-whx-faint">{uiText('Resolvida em')} {formatDate(item.resolved_at)}</span>}</section>}
  </div>
}

function Empty({ text }: { text: string }) { return <div className="grid min-h-16 place-items-center px-3 text-center text-[calc(11px*var(--ui-font-scale))] text-whx-faint">{text}</div> }
function CodeBlock({ children, danger = false }: { children: string; danger?: boolean }) { return <pre className={`m-0 max-h-44 overflow-auto whitespace-pre-wrap break-words bg-whx-bg p-2 font-mono text-[calc(11px*var(--ui-font-scale))] leading-relaxed ${danger ? 'text-whx-danger' : 'text-whx-soft'}`}>{children}</pre> }
function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) { return <span className="inline-flex items-baseline gap-1.5"><b className={`font-mono text-[calc(12px*var(--ui-font-scale))] font-semibold ${danger ? 'text-whx-danger' : 'text-whx-text'}`}>{value}</b>{label}</span> }
function Meta({ label, value }: { label: string; value?: string }) { return value ? <div className="min-w-0 border-b border-r border-whx-border-soft px-2 py-1.5 last:border-r-0"><dt className="text-[calc(10px*var(--ui-font-scale))] text-whx-faint">{label}</dt><dd className="m-0 truncate font-mono text-[calc(11px*var(--ui-font-scale))] text-whx-soft" title={value}>{value}</dd></div> : null }
function formatDate(value?: string) { if (!value) return '—'; const date = new Date(value); const locale = { en: 'en-US', pt: 'pt-PT', fr: 'fr-FR' }[interfaceLocale()]; return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date) }

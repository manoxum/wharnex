import { useState } from 'react'
import { CORRELATION_LABELS, LEVEL_PRESENTATION, correlationsOf, type CorrelationField, type OperationalRecord } from '../../../lib/transport/http/operationalLog'

function clock(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.toLocaleTimeString('pt-PT', { hour12: false })}.${String(date.getMilliseconds()).padStart(3, '0')}`
}

function shortId(value: string) {
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value
}

export function OperationalLogRow({ record, onPivot }: { record: OperationalRecord; onPivot: (field: CorrelationField, value: string) => void }) {
  const [open, setOpen] = useState(false)
  const level = LEVEL_PRESENTATION[record.level] || LEVEL_PRESENTATION.info
  const correlations = correlationsOf(record)
  const hasData = Boolean(record.data && Object.keys(record.data).length) || Boolean(record.event_ref)
  return <li className="border-b border-whx-border-soft px-3 py-2 text-sm">
    <div className="flex min-w-0 items-baseline gap-2">
      <time className="shrink-0 font-mono text-xs text-whx-faint" dateTime={record.occurred_at} title={record.occurred_at}>{clock(record.occurred_at)}</time>
      <span className={`shrink-0 rounded border px-1.5 font-mono text-xs uppercase ${level.tone}`}>{level.label}</span>
      <span className="shrink-0 font-mono text-xs text-whx-faint">{record.source}</span>
      <button type="button" className="min-w-0 flex-1 truncate text-left font-mono text-sm text-whx-text hover:text-whx-accent disabled:hover:text-whx-text" disabled={!hasData} aria-expanded={hasData ? open : undefined} onClick={() => setOpen((value) => !value)} title={hasData ? 'Mostrar detalhes' : record.event}>
        {record.event}
      </button>
    </div>
    {record.message ? <p className="mb-0 mt-1 line-clamp-3 break-words text-sm text-whx-soft">{record.message}</p> : null}
    {correlations.length ? <div className="mt-1.5 flex flex-wrap gap-1">
      {correlations.map(({ field, value }) => <button key={field} type="button" onClick={() => onPivot(field, value)}
        className="rounded-full border border-whx-border bg-whx-muted px-2 font-mono text-xs text-whx-soft hover:border-whx-accent hover:text-whx-accent"
        title={`Filtrar por ${CORRELATION_LABELS[field].toLowerCase()} ${value}`} aria-label={`Filtrar por ${CORRELATION_LABELS[field].toLowerCase()} ${value}`}>
        {CORRELATION_LABELS[field]} {shortId(value)}
      </button>)}
    </div> : null}
    {open && hasData ? <pre className="mb-0 mt-2 max-h-64 overflow-auto rounded-lg border border-whx-border bg-whx-bg p-2 font-mono text-xs text-whx-soft">
      {JSON.stringify({ component: record.component, category: record.category, event_ref: record.event_ref, session_id: record.session_id, data: record.data }, null, 2)}
    </pre> : null}
  </li>
}

import { memo, useMemo, useState } from 'react'
import { statusMeta } from '../../../../lib/execution/history/executionStatus'
import type { HarnessEvent } from '../../../../types/agent/task-queue'
import { EvidenceListPager } from './EvidenceListPager'

type Props = {
  events: HarnessEvent[]
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  total: number
  onShowMore: () => void
}

export function EvolutionEventsList({ events, selected, onToggle, total, onShowMore }: Props) {
  return <div className="grid gap-0">
    {events.map((event) => <EventCard key={event.id} event={event} selected={selected.has(event.id)} onToggle={onToggle}/>) }
    {total > 0 && <EvidenceListPager shown={events.length} total={total} label="eventos" onShowMore={onShowMore}/>}
  </div>
}

const EventCard = memo(function EventCard({ event, selected, onToggle }: { event: HarnessEvent; selected: boolean; onToggle: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const payload = useMemo(() => expanded ? JSON.stringify(event.data, null, 2) || '' : '', [event.data, expanded])
  const status = statusMeta(event)
  const statusTone = status.lifecycleState === 'active' ? 'text-whx-running' : status.tone === 'ok' ? 'text-whx-success' : status.tone === 'warning' ? 'text-whx-warning' : 'text-whx-danger'
  const timestamp = new Date(event.timestamp)
  return (
    <article className={`[content-visibility:auto] [contain-intrinsic-size:auto_100px] border-0 border-l border-solid border-l-whx-border-soft px-3 py-2 transition-colors motion-reduce:transition-none ${selected ? 'bg-whx-selection' : 'bg-transparent hover:bg-whx-hover'}`}>
      <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
        <input className="mt-1" type="checkbox" aria-label={`Selecionar evento ${event.type}`} checked={selected} onChange={() => onToggle(event.id)}/>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`shrink-0 font-mono text-whx-caption ${statusTone}`}>{status.badge}</span>
            <strong className="truncate text-whx-label font-medium text-whx-text">{status.title}</strong>
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-whx-caption text-whx-soft">{event.category}</span>
            <code className="min-w-0 truncate text-whx-caption text-whx-faint">{event.type}</code>
          </span>
          <small className="mt-1 block truncate text-whx-caption text-whx-faint">{event.project_name || event.project_path}</small>
        </span>
        <time dateTime={event.timestamp} className="text-right text-whx-caption leading-4 text-whx-faint">
          {timestamp.toLocaleDateString()}<br/>{timestamp.toLocaleTimeString()}
        </time>
      </label>
      {status.detail && <p className="mb-0 ml-6 mt-1.5 truncate text-sm text-whx-soft" title={status.detail}>{status.detail}</p>}
      <details className="mt-1.5 text-whx-caption text-whx-faint" onToggle={(change) => setExpanded(change.currentTarget.open)}>
        <summary className="cursor-pointer select-none hover:text-whx-text">Dados</summary>
        {expanded && <pre className="mt-2 max-h-40 overflow-auto bg-whx-control p-2 text-whx-caption whitespace-pre-wrap">{payload}</pre>}
      </details>
    </article>
  )
})

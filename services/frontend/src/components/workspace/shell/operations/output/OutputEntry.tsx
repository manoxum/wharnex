import type { ExecutionTimelineEntry } from '../../../../../lib/execution/history/executionTimeline'
import { translate as uiText } from '../../../../../lib/workspace/localization'
import { Icon } from '../../../../presentation/chrome/Icon'
import { outputLevel, outputSource } from './outputFilter'
import { formatDuration } from './outputFormat'

export function OutputEntry({ entry }: { entry: ExecutionTimelineEntry }) {
  const details = Boolean(entry.argv?.length || entry.rationale || entry.detail || entry.outputSegments.length || entry.requestId)
  const source = sourceLabel(outputSource(entry))
  const level = outputLevel(entry)
  const preview = entry.outputSegments.find((segment) => segment.text.trim())?.text.trim().replace(/\s+/g, ' ')
  const secondary = [entry.detail, preview].filter(Boolean).join(' · ')
  const tone = level === 'error' ? 'bg-whx-danger' : level === 'warning' ? 'bg-whx-warning' : 'bg-whx-success'
  const badgeTone = level === 'error' ? 'text-whx-danger bg-whx-danger/10' : level === 'warning' ? 'text-whx-warning bg-whx-warning/10' : 'text-whx-faint bg-whx-hover'
  const row = <div className="flex min-h-9 min-w-0 items-center gap-2 px-3 py-1.5">
    <span className={`size-1.5 shrink-0 rounded-full ${tone}`} aria-hidden="true"/>
    <span className="grid min-w-0 flex-1 gap-0.5"><span className="flex min-w-0 items-baseline gap-1.5"><strong className="min-w-0 flex-1 truncate text-whx-body font-medium leading-4 text-whx-text" title={entry.title}>{uiText(entry.title)}</strong><span className="shrink-0 text-whx-caption text-whx-faint">{source}</span></span>{secondary && <span className="min-w-0 truncate text-whx-caption leading-4 text-whx-soft" title={secondary}>{secondary}</span>}</span>
    {entry.durationMs != null && <span className="hidden shrink-0 font-mono text-whx-caption tabular-nums text-whx-faint @[600px]/output:inline">{formatDuration(entry.durationMs)}</span>}
    <time className="shrink-0 font-mono text-whx-caption tabular-nums text-whx-faint" title={`${entry.timestamp} UTC`}>{formatTime(entry.timestamp)}</time>
    <span className={`min-w-[38px] rounded px-1.5 py-0.5 text-center font-mono text-whx-caption leading-3 ${badgeTone}`}>{entry.badge}</span>
    <span className="grid w-3 shrink-0 place-items-center text-whx-faint">{details && <span className="transition-transform group-open:rotate-90"><Icon name="chevron-right" size={13}/></span>}</span>
  </div>
  if (!details) return <article className="border-b border-whx-border-soft/70 transition-colors hover:bg-whx-hover/50">{row}</article>
  return <details className="group border-b border-whx-border-soft/70 transition-colors hover:bg-whx-hover/40">
    <summary className="list-none cursor-pointer outline-none marker:hidden focus-visible:bg-whx-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-whx-accent [&::-webkit-details-marker]:hidden">{row}</summary>
    <div className="grid min-w-0 gap-2 px-6 pb-2.5 text-whx-label text-whx-soft">
      <dl className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-whx-surface/60 px-2.5 py-2 [&>dt]:text-whx-faint">
        {entry.argv?.length ? <><dt>{uiText('Comando')}</dt><dd className="m-0 break-all font-mono">{entry.argv.join(' ')}</dd></> : null}
        {entry.detail && <><dt>{uiText('Contexto')}</dt><dd className="m-0 break-all">{entry.detail}</dd></>}
        <dt>{uiText('Hora')}</dt><dd className="m-0 font-mono">{entry.timestamp} UTC</dd>
        {entry.durationMs != null && <><dt>{uiText('Duração')}</dt><dd className="m-0 font-mono">{formatDuration(entry.durationMs)}</dd></>}
        {entry.requestId && <><dt>{uiText('Pedido')}</dt><dd className="m-0 break-all font-mono">{entry.requestId}</dd></>}
      </dl>
      {entry.rationale && <p className="m-0 border-l-2 border-whx-border-soft pl-2 leading-4">{entry.rationale}</p>}
      {entry.outputSegments.map((segment, index) => <section key={`${entry.id}:${index}`} className="min-w-0 overflow-hidden rounded-md border border-whx-border-soft/70 bg-whx-surface/60">
        <div className="flex min-h-6 items-center justify-between border-b border-whx-border-soft/60 px-2 text-whx-caption uppercase tracking-wide text-whx-faint"><span>{uiText(segment.stream === 'meta' ? 'Detalhes' : segment.stream)}</span><span>{lineCount(segment.text)}</span></div>
        <pre className={`m-0 max-h-40 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono leading-[1.55] ${segment.stream === 'stderr' ? 'text-whx-danger' : 'text-whx-soft'}`}>{segment.text}</pre>
      </section>)}
    </div>
  </details>
}

function sourceLabel(source: string) { return uiText(source === 'command' ? 'Comandos' : source === 'patch' ? 'Alterações' : 'Eventos') }
function lineCount(value: string) { return `${value.split('\n').length} ${uiText('linhas')}` }
function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const locale = { en: 'en-US', pt: 'pt-PT', fr: 'fr-FR' }[document.documentElement.lang.slice(0, 2)] || 'en-US'
  return new Intl.DateTimeFormat(locale, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date)
}

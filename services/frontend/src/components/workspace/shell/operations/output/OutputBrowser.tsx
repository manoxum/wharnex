import { useMemo, useState } from 'react'
import type { HarnessEvent } from '../../../../../types'
import { buildExecutionTimeline } from '../../../../../lib/execution/history/executionTimeline'
import { translate as uiText } from '../../../../../lib/workspace/localization'
import { Button, IconButton, Input, Select } from '../../../../presentation/workbench'
import { EMPTY_OUTPUT_FILTER, matchesOutput, outputSource, type OutputFilter } from './outputFilter'
import { groupOutputEntries } from './outputGroups'
import { OutputResults } from './OutputResults'

export function OutputBrowser({ events, loading = false, error = '' }: { events: HarnessEvent[]; loading?: boolean; error?: string }) {
  const [filter, setFilter] = useState<OutputFilter>(EMPTY_OUTPUT_FILTER)
  const [grouped, setGrouped] = useState(true)
  const entries = useMemo(() => buildExecutionTimeline(events), [events])
  const sources = useMemo(() => [...new Set(entries.map(outputSource))].sort(), [entries])
  const visible = useMemo(() => entries.filter((entry) => matchesOutput(entry, filter)), [entries, filter])
  const groups = useMemo(() => groupOutputEntries(visible), [visible])
  const active = Object.values(filter).some(Boolean)
  const field = '!h-8 !min-h-8 !border-whx-border-soft !bg-whx-surface !px-2 !py-0'
  return <section aria-label={uiText('Saída de execução')} className="@container/output flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-whx-bg text-whx-text">
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-b border-whx-border-soft bg-whx-side px-2.5 py-1.5">
      <Input type="search" aria-label={uiText('Pesquisar saída')} placeholder={uiText('Pesquisar logs…')} className={`${field} min-w-[140px] flex-[1_1_180px]`} value={filter.text} onChange={(event) => setFilter({ ...filter, text: event.target.value })}/>
      <Select aria-label={uiText('Origem da saída')} className={`${field} w-[112px]`} value={filter.source} onChange={(event) => setFilter({ ...filter, source: event.target.value })}>
        <option value="">{uiText('Origem')}</option>{sources.map((source) => <option key={source} value={source}>{sourceLabel(source)}</option>)}
      </Select>
      <Select aria-label={uiText('Nível da saída')} className={`${field} w-[104px]`} value={filter.level} onChange={(event) => setFilter({ ...filter, level: event.target.value })}>
        <option value="">{uiText('Nível')}</option><option value="info">{uiText('Informação')}</option><option value="warning">{uiText('Avisos')}</option><option value="error">{uiText('Erros / stderr')}</option>
      </Select>
      <Input type="date" aria-label={uiText('Data da saída (UTC)')} title={uiText('Data dos eventos em UTC')} className={`${field} w-[132px]`} value={filter.date} onChange={(event) => setFilter({ ...filter, date: event.target.value })}/>
      <Button className={`!h-8 !min-h-8 !px-2 ${grouped ? '!border-whx-accent/40 !bg-whx-accent/10 !text-whx-accent' : ''}`} tone="neutral" aria-label={uiText('Agrupar por pedido')} aria-pressed={grouped} onClick={() => setGrouped((current) => !current)}>{uiText('Por pedido')}</Button>
      {active && <IconButton label={uiText('Limpar filtros')} icon="close" onClick={() => setFilter(EMPTY_OUTPUT_FILTER)}/>}
      <span className="ml-auto shrink-0 px-1 font-mono text-whx-caption tabular-nums text-whx-faint" aria-live="polite">{active ? `${visible.length} / ` : ''}{entries.length}</span>
    </div>
    {error && <div role="status" className="shrink-0 border-b border-whx-warning/20 bg-whx-warning/5 px-3 py-1.5 text-whx-label text-whx-warning">{error}</div>}
    <OutputResults entries={visible} groups={groups} grouped={grouped} loading={loading} total={entries.length}/>
  </section>
}

function sourceLabel(source: string) { return uiText(source === 'command' ? 'Comandos' : source === 'patch' ? 'Alterações' : 'Eventos') }

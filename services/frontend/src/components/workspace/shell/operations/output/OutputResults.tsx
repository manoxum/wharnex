import type { ExecutionTimelineEntry } from '../../../../../lib/execution/history/executionTimeline'
import { translate as uiText } from '../../../../../lib/workspace/localization'
import { ContentSkeleton } from '../../../../presentation/chrome/Skeleton'
import { OutputEntry } from './OutputEntry'
import { OutputRequestGroup } from './OutputRequestGroup'
import type { OutputGroup } from './outputGroups'

export function OutputResults({ entries, groups, grouped, loading, total }: {
  entries: ExecutionTimelineEntry[]
  groups: OutputGroup[]
  grouped: boolean
  loading: boolean
  total: number
}) {
  if (loading && !total) return <div className="p-2"><ContentSkeleton label={uiText('A carregar saída')} rows={2} compact/></div>
  if (!entries.length) return <div className="flex min-h-16 flex-1 items-start px-3 py-3 text-whx-label text-whx-faint">{total ? uiText('Nenhum evento corresponde aos filtros.') : uiText('Ainda não há saída de execução.')}</div>
  return <div role="log" aria-label={uiText('Eventos de execução')} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
    {grouped ? groups.map((group) => group.requestId && group.entries.length > 1
      ? <OutputRequestGroup key={group.id} group={group}/>
      : group.entries.map((entry) => <OutputEntry key={entry.id} entry={entry}/>))
      : entries.map((entry) => <OutputEntry key={entry.id} entry={entry}/>)}
  </div>
}

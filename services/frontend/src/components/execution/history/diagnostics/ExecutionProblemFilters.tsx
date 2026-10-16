import { WorkbenchTabs } from '../../../presentation/tabs'
import { ControlPopover, Input } from '../../../presentation/workbench'

export type ErrorFilter = 'all' | 'open' | 'resolved'
export function ExecutionProblemFilters({ filter, onFilter, query, onQuery, totals, distribution }: {
  filter: ErrorFilter; onFilter: (filter: ErrorFilter) => void; query: string; onQuery: (query: string) => void
  totals: { total: number; open: number; resolved: number; kinds: number }; distribution: [string, number][]
}) {
  return <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 bg-whx-side px-2" aria-label="Filtrar problemas">
    <WorkbenchTabs label="Estado das ocorrências" value={filter} onChange={onFilter} className="min-w-0 !min-h-10 !border-0 !bg-transparent !p-0 [&>[data-workbench-tab]]:!grow-0" items={[
      { id: 'all', label: 'Todas', icon: 'list', badge: totals.total },
      { id: 'open', label: 'Abertas', icon: 'alert', badge: totals.open },
      { id: 'resolved', label: 'Resolvidas', icon: 'check', badge: totals.resolved },
    ]}/>
    <Input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Erro, causa, request, plano…" aria-label="Pesquisar erros de execução" className="!ml-auto !w-[min(260px,100%)] !flex-[1_1_160px] !max-w-[340px]"/>
    <ControlPopover label="Distribuição por tipo de falha" triggerLabel={`Tipos de falha; ${totals.kinds} ${totals.kinds === 1 ? 'tipo' : 'tipos'}`} icon="filter" density="compact">
      <div className="grid gap-2">{distribution.length ? distribution.map(([kind, count]) => <div className="flex min-w-0 items-center justify-between gap-3 text-whx-label text-whx-soft" key={kind}><span className="truncate">{kind}</span><span className="font-mono text-whx-faint">{count}</span></div>) : <span className="text-whx-label text-whx-faint">Sem ocorrências registadas.</span>}</div>
    </ControlPopover>
  </div>
}

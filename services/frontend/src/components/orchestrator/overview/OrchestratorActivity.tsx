import { translate as uiText, formatMessage } from '../../../lib/workspace/localization'
import type { OrchestratorOverview, OrchestratorTask } from '../../../types'
import { Button } from '../../presentation/workbench'
import { OrchestratorRecentReviews } from './OrchestratorRecentReviews'

export function OrchestratorActivity({ overview, onOpenTasks, onSelectTask }: {
  overview: OrchestratorOverview; onOpenTasks: () => void; onSelectTask: (task: OrchestratorTask) => void
}) {
  const active = overview.tasks.filter((task) => task.status === 'DOING')
  return <section className="orchestrator-cockpit @container/activity mx-auto mb-6 w-full max-w-[1100px] pt-4" aria-label={uiText("Fluxo do projeto")}>
    <header className="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-3">
      <strong className="text-whx-title font-medium text-whx-soft">{uiText("Fluxo do projeto")}</strong>
      <Button tone="quiet" icon="arrow-right" onClick={onOpenTasks}>{uiText("Abrir todas as Tasks")}</Button>
    </header>
    <div className="grid grid-cols-4 gap-x-6 gap-y-4 @max-[600px]/activity:grid-cols-2">
      <Metric label={uiText("Em execução")} value={active.length} note={formatMessage("{used}/{total} slot de mutação", { used: overview.mutation_slots_used, total: overview.mutation_slots })}/>
      <Metric label={uiText("Prontas")} value={overview.tasks.filter((task) => task.status === 'READY').length}/>
      <Metric label={uiText("Em revisão")} value={overview.tasks.filter((task) => task.status === 'REVIEW').length}/>
      <Metric label={uiText("Concluídas")} value={overview.tasks.filter((task) => task.status === 'COMPLETE').length}/>
    </div>
    <div className="mt-5 grid grid-cols-[minmax(200px,.75fr)_minmax(0,1.7fr)] gap-5 @max-[600px]/activity:grid-cols-1">
      <div className="grid content-start gap-1 py-3">
        <strong className={`text-whx-label font-medium ${overview.mutation_slots_used ? 'text-whx-running' : 'text-whx-soft'}`}>Mutation slot · {overview.mutation_slots_used ? uiText("Ocupado") : uiText("Livre")}</strong>
        <small className="text-whx-caption leading-relaxed text-whx-faint">{overview.mutation_slots_used ? active[0]?.title || 'Ocupado' : uiText("Livre para a próxima tarefa READY")}</small>
      </div>
      <OrchestratorRecentReviews reviews={overview.recent_reviews || []} tasks={overview.tasks} onSelectTask={onSelectTask}/>
    </div>
  </section>
}

function Metric({ label, value, note }: { label: string; value: number; note?: string }) {
  return <div className="grid min-w-0 content-start gap-1">
    <span className="text-whx-caption text-whx-faint">{label}</span>
    <strong className={`font-mono text-whx-title font-medium tabular-nums ${value ? 'text-whx-text' : 'text-whx-faint'}`}>{value}</strong>
    {note && <small className="text-whx-caption leading-relaxed text-whx-faint">{note}</small>}
  </div>
}

import type { OrchestratorRecentReview, OrchestratorTask } from '../../../types'
import { Icon } from '../../presentation/chrome/Icon'

export function OrchestratorRecentReviews({ reviews, tasks, onSelectTask }: {
  reviews: OrchestratorRecentReview[]
  tasks: OrchestratorTask[]
  onSelectTask: (task: OrchestratorTask) => void
}) {
  const visible = reviews.slice(0, 5)
  const tasksByID = new Map(tasks.map((task) => [task.id, task]))

  return <section className="min-w-0 p-1.5" aria-label="Revisões pendentes mais recentes">
    <header className="flex items-center justify-between gap-3 px-2 py-2">
      <div className="min-w-0">
        <span className="block text-sm font-extrabold uppercase tracking-[0.06em] text-[var(--theme-accent)]">Revisões pendentes</span>
        <strong className="text-base text-[var(--theme-text)]">Últimas tarefas aguardando conclusão</strong>
      </div>
      <span className="shrink-0 text-sm text-[var(--theme-text-soft)]">{visible.length}/5</span>
    </header>

    {visible.length ? <div className="grid gap-px">
      {visible.map((review) => {
        const task = tasksByID.get(review.task_id)
        return <button
          key={review.run_id}
          type="button"
          aria-label={`Abrir revisão de ${review.title}`}
          disabled={!task}
          onClick={() => task && onSelectTask(task)}
          className="grid min-h-[47px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[7px] border-0 bg-transparent px-[9px] py-[7px] text-left text-[var(--theme-text)] enabled:cursor-pointer enabled:hover:bg-[var(--theme-hover)] disabled:opacity-60"
        >
          <span className="rounded bg-[var(--theme-subtle)] px-1.5 py-0.5 text-sm font-bold text-[var(--theme-text-muted)]">REVIEW</span>
          <span className="grid min-w-0 gap-0.5">
            <strong className="truncate text-base">{review.title}</strong>
            <small className="truncate text-sm text-[var(--theme-text-muted)]">Execução concluída · aguarda conclusão</small>
          </span>
          <Icon name="chevron-right" size={14}/>
        </button>
      })}
    </div> : <div className="px-6 py-5 text-center text-base text-[var(--theme-text-soft)]">
      Nenhuma tarefa aguarda conclusão em REVIEW.
    </div>}
  </section>
}

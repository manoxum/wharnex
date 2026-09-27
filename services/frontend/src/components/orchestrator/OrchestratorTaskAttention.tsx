import type { OrchestratorTask } from '../../types'
import { Icon } from '../Icon'

export function OrchestratorTaskAttention({ tasks, onSelectTask }: { tasks: OrchestratorTask[]; onSelectTask: (task: OrchestratorTask) => void }) {
  const failed = tasks.filter((task) => task.status === 'FAILED' && task.condition === 'failed_run')
  if (!failed.length) return null

  return <section aria-label="Tarefas que requerem atenção" className="mx-auto mt-5 w-full max-w-[1100px] rounded-xl border border-[var(--theme-danger)] bg-[var(--theme-surface)] p-4 text-[var(--theme-text)]">
    <header className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--theme-danger)]">
      <Icon name="alert" size={16}/>
      <span>{failed.length} {failed.length === 1 ? 'tarefa falhou' : 'tarefas falharam'}</span>
    </header>
    <div className="grid gap-2">
      {failed.map((task) => <button key={task.id} type="button" onClick={() => onSelectTask(task)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-[var(--theme-border-soft)] bg-[var(--theme-elevated)] px-3 py-2 text-left text-sm text-[var(--theme-text)] hover:bg-[var(--theme-hover)]">
        <span className="min-w-0"><strong className="block truncate">{task.title}</strong><small className="text-[var(--theme-text-muted)]">Execução falhou · abrir tarefa e histórico</small></span>
        <Icon name="chevron-right" size={14}/>
      </button>)}
    </div>
  </section>
}

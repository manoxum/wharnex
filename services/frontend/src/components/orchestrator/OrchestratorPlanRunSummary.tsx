import { useMemo } from 'react'
import { ORCHESTRATOR_TASK_STATUSES, type OrchestratorPlanningDetail, type OrchestratorTask } from '../../types'

export function OrchestratorPlanProgressSummary({ detail }: { detail: OrchestratorPlanningDetail }) {
  const summary = useMemo(() => {
    const taskCounts = Object.fromEntries(ORCHESTRATOR_TASK_STATUSES.map((status) => [status, 0])) as Record<(typeof ORCHESTRATOR_TASK_STATUSES)[number], number>
    const runCounts: Record<string, number> = {}
    const attemptCounts: Record<string, number> = {}
    let runs = 0
    detail.tasks.forEach(({ task, runs: taskRuns }) => {
      taskCounts[task.status] += 1
      taskRuns.forEach((run) => {
        runs += 1
        const status = String(run.status || 'UNKNOWN').toUpperCase()
        runCounts[status] = (runCounts[status] || 0) + 1
      })
    })
    detail.attempts.forEach((attempt) => {
      const status = String(attempt.status || 'UNKNOWN').toUpperCase()
      attemptCounts[status] = (attemptCounts[status] || 0) + 1
    })
    return { taskCounts, runCounts, attemptCounts, runs }
  }, [detail])

  return <section className="rounded-lg border border-[var(--theme-border)] p-3" aria-label="Resumo de progresso do plano">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <strong className="text-base">Progresso</strong>
      <span className="text-sm text-[var(--theme-text-muted)]">{detail.tasks.length} task{detail.tasks.length === 1 ? '' : 's'} · {summary.runs === 1 ? '1 execução' : `${summary.runs} execuções`} · {detail.attempts.length} tentativa{detail.attempts.length === 1 ? '' : 's'} de planeamento</span>
    </div>
    <p className="mb-0 mt-1 text-sm text-[var(--theme-text-soft)]">Uma task só entra em concluídas quando o estado é COMPLETE; REVIEW continua separado até essa transição.</p>
    <StatusCounts label="Tasks por status" entries={ORCHESTRATOR_TASK_STATUSES.map((status) => [status, summary.taskCounts[status]] as [string, number])}/>
    <StatusCounts label="Execuções por status" entries={Object.entries(summary.runCounts)}/>
    <StatusCounts label="Tentativas por status" entries={Object.entries(summary.attemptCounts)}/>
  </section>
}

function StatusCounts({ label, entries }: { label: string; entries: Array<[string, number]> }) {
  const visible = entries.filter(([, count]) => count > 0)
  return <div className="mt-3">
    <span className="text-sm font-semibold text-[var(--theme-text-muted)]">{label}</span>
    {visible.length ? <div className="mt-1 flex flex-wrap gap-1.5">{visible.map(([status, count]) => <span key={status} className="rounded-full border border-[var(--theme-border-soft)] bg-[var(--theme-subtle)] px-2 py-1 font-mono text-sm"><strong>{count}</strong> {status}</span>)}</div> : <p className="mb-0 mt-1 text-sm text-[var(--theme-text-soft)]">Sem registos.</p>}
  </div>
}

export function OrchestratorPlanExecutionsTab({ detail, onSelectTask }: { detail: OrchestratorPlanningDetail; onSelectTask?: (task: OrchestratorTask) => void }) {
  if (!detail.tasks.length) return <StateMessage message="Ainda não existem execuções registradas para este pedido."/>
  const groups = detail.tasks.map((item) => ({ task: item.task, runs: item.runs.filter((run) => run.task_id === item.task.id) }))
  const count = groups.reduce((total, item) => total + item.runs.length, 0)

  return <div className="grid gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--theme-border-soft)] bg-[var(--theme-subtle)] px-3 py-2">
      <strong className="text-base">Execuções das tasks deste plano</strong>
      <span className="font-mono text-sm text-[var(--theme-text-muted)]">{count === 1 ? '1 execução' : `${count} execuções`}</span>
    </div>
    {groups.map(({ task, runs }) => <section key={task.id} className="rounded-lg border border-[var(--theme-border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><strong className="block truncate text-base">{task.title}</strong><span className="font-mono text-sm text-[var(--theme-text-soft)]">{task.id}</span></div>
        <button type="button" className="shrink-0 rounded-md border border-[var(--theme-border)] bg-transparent px-2.5 py-1.5 text-sm font-semibold text-[var(--theme-text)] disabled:cursor-default disabled:opacity-60" disabled={!onSelectTask} onClick={() => onSelectTask?.(task)} aria-label={`Abrir task ${task.title}`}>Abrir task</button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm text-[var(--theme-text-muted)]"><span>{task.status}</span><span aria-hidden="true">·</span><span>{runs.length === 1 ? '1 execução' : `${runs.length} execuções`}</span></div>
      {!runs.length ? <div className="mt-3 rounded-md border border-dashed border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-text-muted)]">Nenhuma execução registrada para esta task.</div> : <div className="mt-3 grid gap-2">
        {runs.map((run) => <article key={run.id} className="rounded-md border border-[var(--theme-border-soft)] bg-[var(--theme-surface)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-base">Tentativa {run.attempt}</strong><span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-subtle)] px-2 py-1 font-mono text-sm font-bold">{run.status}</span></div>
          <p className="mb-0 mt-2 text-sm text-[var(--theme-text-muted)]">Início {formatDate(run.started_at)} · {run.completed_at ? `Fim ${formatDate(run.completed_at)}` : 'Ainda em execução'}</p>
          <dl className="mb-0 mt-2 grid gap-1 text-sm"><ExecutionIdentifier label="run_id" value={run.id}/><ExecutionIdentifier label="execution_plan_id" value={run.execution_plan_id}/><ExecutionIdentifier label="request_id" value={run.request_id}/><ExecutionIdentifier label="session_id" value={run.session_id}/></dl>
          {run.error ? <div className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--theme-danger)_35%,var(--theme-border))] bg-[color-mix(in_srgb,var(--theme-danger)_8%,transparent)] px-3 py-2"><strong className="text-sm text-[var(--theme-danger)]">Erro</strong><p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--theme-danger)]">{run.error}</p></div> : null}
        </article>)}
      </div>}
    </section>)}
  </div>
}

function StateMessage({ message }: { message: string }) {
  return <div className="mt-3 rounded-lg border border-dashed border-[var(--theme-border)] p-4 text-sm text-[var(--theme-text-muted)]">{message}</div>
}

function ExecutionIdentifier({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2"><dt className="text-[var(--theme-text-soft)]">{label}</dt><dd className="m-0 break-all font-mono text-[var(--theme-text-muted)]">{value}</dd></div>
}

function formatDate(value: string) {
  try { return new Intl.DateTimeFormat('pt', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) } catch { return value }
}

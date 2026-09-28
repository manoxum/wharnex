import { useEffect, useMemo, useState } from 'react'
import { extractWorkerId, resolveTaskChatId, type ChatAgentTaskChatRef } from '../../lib/chatAgentTaskNav'
import { ORCHESTRATOR_TASK_STATUSES, type ChatAgentTask, type OrchestratorPlanningDetail, type OrchestratorPlanningRequest, type OrchestratorTask } from '../../types'
import { Icon } from '../Icon'
import { WorkerFollowViewer } from '../WorkerFollowViewer'
import { OrchestratorPlanFilesTab, OrchestratorPlanTab } from './OrchestratorPlanDetailTabs'

type DetailTab = 'summary' | 'files' | 'plan' | 'tasks' | 'executions'

const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: 'summary', label: 'Resumo' },
  { id: 'files', label: 'Ficheiros' },
  { id: 'plan', label: 'Plano' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'executions', label: 'Execuções' },
]

export function OrchestratorPlanDrawer({ request, detail, planningTask, chats = [], loading, busy = false, error, onClose, onRefresh, onSelectTask, onOpenTasks, onGoToChat, onRetry, onApprove, onReject, onRevise }: {
  request: OrchestratorPlanningRequest
  detail?: OrchestratorPlanningDetail
  planningTask?: ChatAgentTask
  chats?: ChatAgentTaskChatRef[]
  loading: boolean
  busy?: boolean
  error?: string
  onClose: () => void
  onRefresh: () => void
  onSelectTask?: (task: OrchestratorTask) => void
  onOpenTasks?: (planID: string) => void
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onRetry?: () => void
  onApprove?: (planID: string) => void
  onReject?: (planID: string) => void
  onRevise?: (planID: string) => void
}) {
  const [tab, setTab] = useState<DetailTab>('summary')
  const [followedWorker, setFollowedWorker] = useState<string>()
  const planID = detail?.plan?.id
  const requestStatus = detail?.status || request.status
  const workerID = planningTask && ['LEASED', 'RUNNING'].includes(planningTask.status) ? extractWorkerId(planningTask.lease_owner) : undefined
  const resolvedChatID = planningTask ? resolveTaskChatId(planningTask, chats) : undefined
  const canRetry = ['FAILED', 'ATTENTION'].includes(requestStatus)
  const canDecideDraft = detail?.plan?.status === 'DRAFT'

  useEffect(() => { setTab('summary'); setFollowedWorker(undefined) }, [request.request_id])
  useEffect(() => {
    if (followedWorker && followedWorker !== workerID) setFollowedWorker(undefined)
  }, [followedWorker, workerID])

  return <div
    className="fixed inset-0 z-[1240] flex justify-end bg-[color-mix(in_srgb,var(--theme-backdrop)_65%,transparent)]"
    data-chatgpt-overlay-blocker="true"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
  >
    <aside className="grid h-full w-[min(460px,92vw)] grid-rows-[auto_minmax(0,1fr)] border-l border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-[-20px_0_55px_var(--theme-shadow)]" aria-label={`Detalhe do planeamento ${request.request_id}`}>
      <header className="flex min-h-[62px] items-start justify-between gap-3 border-b border-[var(--theme-border-soft)] px-3.5 py-2.5">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate font-mono text-sm leading-[1.3] text-[var(--theme-text-soft)]">{request.request_id}</span>
          <strong className="truncate text-lg">{detail?.plan?.title || request.objective || 'Detalhe do planeamento'}</strong>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-[23px] items-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-subtle)] px-2 font-mono text-sm font-bold leading-none tracking-[0.04em]">{requestStatus}</span>
            <span className="text-sm text-[var(--theme-text-muted)]">Tentativa {detail?.attempt ?? request.attempt}/{detail?.max_attempts ?? request.max_attempts}</span>
          </span>
          <span className="text-sm text-[var(--theme-text-soft)]">Criado {formatDate(request.created_at)} · Atualizado {formatDate(request.updated_at)}</span>
          {detail?.plan ? <span className="truncate text-sm text-[var(--theme-text-soft)]"><span className="font-mono">{detail.plan.id}</span> · {detail.plan.title}</span> : null}
        </div>
        <span className="flex items-center gap-1">
          <button className="grid h-[30px] w-[30px] place-items-center rounded-md border-0 bg-transparent text-[var(--theme-text-muted)]" type="button" disabled={loading || busy} onClick={onRefresh} aria-label="Atualizar detalhe do planeamento" title="Atualizar"><Icon name="refresh" size={15}/></button>
          <button className="grid h-[30px] w-[30px] place-items-center rounded-md border-0 bg-transparent text-[var(--theme-text-muted)]" type="button" onClick={onClose} aria-label="Fechar detalhe do planeamento" title="Fechar"><Icon name="close" size={16}/></button>
        </span>
      </header>

      <div className="min-h-0 overflow-auto p-4">
        <section className="mb-3 rounded-lg border border-[var(--theme-border-soft)] bg-[var(--theme-subtle)] p-3" aria-label="Ações do planeamento">
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-elevated)] px-2.5 py-1.5 text-sm font-semibold" type="button" onClick={() => void copyIdentifier(request.request_id)}><Icon name="copy" size={13}/> Copiar request_id</button>
            {planID ? <button className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-elevated)] px-2.5 py-1.5 text-sm font-semibold" type="button" onClick={() => void copyIdentifier(planID)}><Icon name="copy" size={13}/> Copiar plan_id</button> : null}
            {resolvedChatID && onGoToChat ? <button className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-elevated)] px-2.5 py-1.5 text-sm font-semibold" type="button" onClick={() => onGoToChat(resolvedChatID, planningTask?.session_id)}><Icon name="bridge" size={13}/> Abrir chat</button> : null}
            {workerID ? <button className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-elevated)] px-2.5 py-1.5 text-sm font-semibold" type="button" aria-pressed={followedWorker === workerID} onClick={() => setFollowedWorker((current) => current === workerID ? undefined : workerID)}><Icon name="monitor" size={13}/> {followedWorker === workerID ? 'A acompanhar Worker' : 'Acompanhar Worker'}</button> : null}
            {planID && onOpenTasks ? <button className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-elevated)] px-2.5 py-1.5 text-sm font-semibold" type="button" onClick={() => onOpenTasks(planID)}>Ver tasks</button> : null}
            {canRetry && onRetry ? <button className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-elevated)] px-2.5 py-1.5 text-sm font-semibold" type="button" disabled={busy} onClick={onRetry}><Icon name="refresh" size={13}/> Retentar planeamento</button> : null}
          </div>
          {canDecideDraft && planID ? <div className="mt-2 flex flex-wrap gap-2 border-t border-[var(--theme-border-soft)] pt-2">
            {onReject ? <button className="rounded-md border border-[var(--theme-border)] bg-transparent px-2.5 py-1.5 text-sm font-semibold text-[var(--theme-danger)]" type="button" disabled={busy} onClick={() => onReject(planID)}><Icon name="close" size={13}/> Rejeitar plano</button> : null}
            {onRevise ? <button className="rounded-md border border-[var(--theme-border)] bg-transparent px-2.5 py-1.5 text-sm font-semibold" type="button" disabled={busy} onClick={() => onRevise(planID)}><Icon name="refresh" size={13}/> Revisar plano</button> : null}
            {onApprove ? <button className="primary rounded-md px-2.5 py-1.5 text-sm font-semibold" type="button" disabled={busy} onClick={() => onApprove(planID)}><Icon name="check" size={13}/> Aprovar plano</button> : null}
          </div> : null}
        </section>

        {followedWorker ? <WorkerFollowViewer agentId={followedWorker} onStop={() => setFollowedWorker(undefined)}/> : null}

        <div className="mt-1 flex gap-4 overflow-x-auto border-b border-[var(--theme-border-soft)]" role="tablist" aria-label="Detalhe do planeamento">
          {tabs.map((item) => <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`-mb-px min-h-9 shrink-0 border-x-0 border-t-0 border-b-2 bg-transparent px-1 text-sm font-semibold ${tab === item.id ? 'border-[var(--theme-accent)] text-[var(--theme-text)]' : 'border-transparent text-[var(--theme-text-muted)]'}`}
            onClick={() => setTab(item.id)}
          >{item.label}</button>)}
        </div>

        {loading && !detail ? <StateMessage kind="loading" message="A carregar detalhe do pedido…"/> : null}
        {loading && detail ? <p className="mt-3 text-sm text-[var(--theme-text-muted)]" role="status">A atualizar detalhe…</p> : null}
        {error ? <div className="mt-3 rounded-lg border border-[var(--theme-danger)] p-3" role="alert">
          <strong className="text-base">Não foi possível carregar o detalhe.</strong>
          <p className="mb-0 mt-1 text-sm text-[var(--theme-text-muted)]">{error}</p>
          <button className="mt-2 text-sm font-semibold" type="button" onClick={onRefresh}>Tentar novamente</button>
        </div> : null}

        {!detail || (error && !loading) ? null : <div className="mt-3" role="tabpanel">
          {tab === 'summary' ? <SummaryTab request={request} detail={detail}/> : null}
          {tab === 'files' ? <OrchestratorPlanFilesTab detail={detail}/> : null}
          {tab === 'plan' ? <OrchestratorPlanTab detail={detail}/> : null}
          {tab === 'tasks' ? <TasksTab detail={detail}/> : null}
          {tab === 'executions' ? <ExecutionsTab detail={detail} onSelectTask={onSelectTask}/> : null}
        </div>}
      </div>
    </aside>
  </div>
}

function StateMessage({ kind, message }: { kind: 'loading' | 'empty' | 'info'; message: string }) {
  return <div className="mt-3 rounded-lg border border-dashed border-[var(--theme-border)] p-4 text-sm text-[var(--theme-text-muted)]" role={kind === 'loading' ? 'status' : undefined}>{message}</div>
}

function SummaryTab({ request, detail }: { request: OrchestratorPlanningRequest; detail: OrchestratorPlanningDetail }) {
  const objective = detail.objective || request.objective
  return <div className="grid gap-3">
    <ProgressSummary detail={detail}/>
    <section>
      <strong className="text-base">Objetivo</strong>
      <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--theme-text-muted)]">{objective || 'Sem objetivo registrado.'}</p>
    </section>
    {detail.prompt ? <section>
      <strong className="text-base">Prompt</strong>
      <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--theme-text-muted)]">{detail.prompt}</p>
    </section> : null}
    <section>
      <strong className="text-base">Contexto do pedido</strong>
      <p className="mb-0 mt-1 text-sm text-[var(--theme-text-muted)]">{detail.include_context ? 'Contexto do projeto incluído.' : 'Contexto completo do projeto não incluído.'}</p>
    </section>
    {(detail.last_error || request.last_error) ? <section>
      <strong className="text-base">Último erro</strong>
      <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--theme-danger)]">{detail.last_error || request.last_error}</p>
    </section> : null}
  </div>
}

function ProgressSummary({ detail }: { detail: OrchestratorPlanningDetail }) {
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

function TasksTab({ detail }: { detail: OrchestratorPlanningDetail }) {
  const count = detail.tasks.length
  if (!count) return <StateMessage kind="empty" message="Nenhuma task foi criada para este plano."/>
  return <StateMessage kind="info" message={`${count} task${count === 1 ? '' : 's'} ${count === 1 ? 'disponível' : 'disponíveis'} para este plano.`}/>
}

function ExecutionsTab({ detail, onSelectTask }: { detail: OrchestratorPlanningDetail; onSelectTask?: (task: OrchestratorTask) => void }) {
  if (!detail.tasks.length) return <StateMessage kind="empty" message="Ainda não existem execuções registradas para este pedido."/>

  const groups = detail.tasks.map((item) => ({
    task: item.task,
    runs: item.runs.filter((run) => run.task_id === item.task.id),
  }))
  const count = groups.reduce((total, item) => total + item.runs.length, 0)

  return <div className="grid gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--theme-border-soft)] bg-[var(--theme-subtle)] px-3 py-2">
      <strong className="text-base">Execuções das tasks deste plano</strong>
      <span className="font-mono text-sm text-[var(--theme-text-muted)]">{count === 1 ? '1 execução' : `${count} execuções`}</span>
    </div>
    {groups.map(({ task, runs }) => <section key={task.id} className="rounded-lg border border-[var(--theme-border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block truncate text-base">{task.title}</strong>
          <span className="font-mono text-sm text-[var(--theme-text-soft)]">{task.id}</span>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md border border-[var(--theme-border)] bg-transparent px-2.5 py-1.5 text-sm font-semibold text-[var(--theme-text)] disabled:cursor-default disabled:opacity-60"
          disabled={!onSelectTask}
          onClick={() => onSelectTask?.(task)}
          aria-label={`Abrir task ${task.title}`}
        >Abrir task</button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-sm text-[var(--theme-text-muted)]">
        <span>{task.status}</span>
        <span aria-hidden="true">·</span>
        <span>{runs.length === 1 ? '1 execução' : `${runs.length} execuções`}</span>
      </div>
      {!runs.length ? <div className="mt-3 rounded-md border border-dashed border-[var(--theme-border)] px-3 py-2 text-sm text-[var(--theme-text-muted)]">Nenhuma execução registrada para esta task.</div> : <div className="mt-3 grid gap-2">
        {runs.map((run) => <article key={run.id} className="rounded-md border border-[var(--theme-border-soft)] bg-[var(--theme-surface)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-base">Tentativa {run.attempt}</strong>
            <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-subtle)] px-2 py-1 font-mono text-sm font-bold">{run.status}</span>
          </div>
          <p className="mb-0 mt-2 text-sm text-[var(--theme-text-muted)]">Início {formatDate(run.started_at)} · {run.completed_at ? `Fim ${formatDate(run.completed_at)}` : 'Ainda em execução'}</p>
          <dl className="mb-0 mt-2 grid gap-1 text-sm">
            <ExecutionIdentifier label="run_id" value={run.id}/>
            <ExecutionIdentifier label="execution_plan_id" value={run.execution_plan_id}/>
            <ExecutionIdentifier label="request_id" value={run.request_id}/>
            <ExecutionIdentifier label="session_id" value={run.session_id}/>
          </dl>
          {run.error ? <div className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--theme-danger)_35%,var(--theme-border))] bg-[color-mix(in_srgb,var(--theme-danger)_8%,transparent)] px-3 py-2">
            <strong className="text-sm text-[var(--theme-danger)]">Erro</strong>
            <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--theme-danger)]">{run.error}</p>
          </div> : null}
        </article>)}
      </div>}
    </section>)}
  </div>
}

function ExecutionIdentifier({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2"><dt className="text-[var(--theme-text-soft)]">{label}</dt><dd className="m-0 break-all font-mono text-[var(--theme-text-muted)]">{value}</dd></div>
}

async function copyIdentifier(value: string) {
  try { await navigator.clipboard?.writeText(value) } catch { /* clipboard is a convenience action; keep the detail usable if unavailable */ }
}

function formatDate(value: string) {
  try { return new Intl.DateTimeFormat('pt', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) } catch { return value }
}

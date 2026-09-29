import type { ChatAgentTask, OrchestratorOverview, OrchestratorPlan } from '../../types'
import { taskBrowserAgentId, resolveTaskChatId, type ChatAgentTaskChatRef } from '../../lib/chatAgentTaskNav'
import { Icon } from '../Icon'
import { useOrchestratorWorkerFollowRegistry } from './useOrchestratorWorkerFollows'

type PlanningRequest = OrchestratorOverview['planning_requests'][number]
const actionClassName = 'inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-elevated)] px-2.5 text-sm font-semibold text-[var(--theme-text-soft)] hover:border-[var(--theme-accent)] hover:bg-[var(--theme-hover)] hover:text-[var(--theme-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]'
const retryClassName = 'inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--theme-danger)] bg-transparent px-2.5 text-sm font-bold text-[var(--theme-danger)] hover:bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-danger)] disabled:cursor-default disabled:opacity-50'

function statusPresentation(status: string) {
  switch (status) {
    case 'PENDING':
      return { label: 'Pendente', icon: 'pause' as const, card: 'border-l-[var(--theme-accent)] bg-[var(--theme-surface)]', marker: 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]', badge: 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] text-[var(--theme-text)]' }
    case 'WAITING':
      return { label: 'A aguardar', icon: 'pause' as const, card: 'border-l-[var(--theme-warning)] bg-[var(--theme-surface)]', marker: 'bg-[color-mix(in_srgb,var(--theme-warning)_14%,var(--theme-surface))] text-[var(--theme-warning)]', badge: 'border-[var(--theme-warning)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,var(--theme-surface))] text-[var(--theme-warning)]' }
    case 'LEASED':
      return { label: 'Preparando', icon: 'activity' as const, card: 'border-l-[var(--theme-accent)] bg-[var(--theme-surface)]', marker: 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]', badge: 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] text-[var(--theme-text)]' }
    case 'RUNNING':
      return { label: 'Em andamento', icon: 'activity' as const, card: 'border-l-[var(--theme-accent)] bg-[var(--theme-surface)]', marker: 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]', badge: 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] text-[var(--theme-text)]' }
    case 'FAILED':
    case 'ATTENTION':
      return { label: 'Requer atenção', icon: 'alert' as const, card: 'border-l-[var(--theme-danger)] bg-[var(--theme-surface)]', marker: 'bg-[color-mix(in_srgb,var(--theme-danger)_12%,var(--theme-surface))] text-[var(--theme-danger)]', badge: 'border-[var(--theme-danger)] bg-[color-mix(in_srgb,var(--theme-danger)_9%,var(--theme-surface))] text-[var(--theme-danger)]' }
    case 'DONE':
      return { label: 'Concluído', icon: 'check' as const, card: 'border-l-[var(--theme-success)] bg-[var(--theme-surface)]', marker: 'bg-[color-mix(in_srgb,var(--theme-success)_12%,var(--theme-surface))] text-[var(--theme-success)]', badge: 'border-[var(--theme-success)] bg-[color-mix(in_srgb,var(--theme-success)_9%,var(--theme-surface))] text-[var(--theme-success)]' }
    case 'CANCELLED':
      return { label: 'Encerrado', icon: 'stop' as const, card: 'border-l-[var(--theme-border)] bg-[var(--theme-surface)]', marker: 'bg-[var(--theme-muted)] text-[var(--theme-text-muted)]', badge: 'border-[var(--theme-border)] bg-[var(--theme-muted)] text-[var(--theme-text-muted)]' }
    default:
      return { label: status, icon: 'info' as const, card: 'border-l-[var(--theme-border)] bg-[var(--theme-surface)]', marker: 'bg-[var(--theme-muted)] text-[var(--theme-text-muted)]', badge: 'border-[var(--theme-border)] bg-[var(--theme-muted)] text-[var(--theme-text-muted)]' }
  }
}

export function OrchestratorPlanningQueue({ requests, tasks, chats, plans = [], busy, onGoToChat, onSelect, onOpenTasks, onRetry }: {
  requests: PlanningRequest[]
  plans?: OrchestratorPlan[]
  onOpenTasks?: (planID: string) => void
  tasks: ChatAgentTask[]
  chats: ChatAgentTaskChatRef[]
  busy: boolean
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  onSelect?: (request: PlanningRequest) => void
  onRetry: (requestId: string) => void
}) {
  const workerFollows = useOrchestratorWorkerFollowRegistry()
  const activeCount = requests.filter((item) => ['PENDING', 'LEASED', 'RUNNING', 'WAITING'].includes(item.status)).length
  if (!requests.length) return null
  return <>
    <section className="mx-auto mb-[22px] w-full max-w-[1100px] overflow-hidden rounded-[14px] border border-[var(--theme-border-soft)] bg-[var(--theme-surface)] shadow-[0_8px_24px_var(--theme-shadow)]" aria-live="polite">
      <header className="flex min-h-[62px] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--theme-border-soft)] bg-[var(--theme-elevated)] px-4 py-3">
        <div className="grid gap-0.5">
          <span className="text-sm font-extrabold uppercase tracking-[0.08em] text-[var(--theme-accent)]">Fila durável</span>
          <h2 className="m-0 text-lg font-semibold text-[var(--theme-text)]">Em planejamento</h2>
        </div>
        <strong className="font-mono text-sm font-semibold leading-[1.3] text-[var(--theme-text-muted)]">{activeCount} ativo{activeCount === 1 ? '' : 's'} · {requests.length} pedido{requests.length === 1 ? '' : 's'}</strong>
      </header>
      <div className="grid max-h-[440px] overflow-x-hidden overflow-y-auto">
        {requests.map((planning) => {
          const backingTask = tasks.find((task) => task.task_id === planning.task_id)
          const workerId = taskBrowserAgentId(backingTask)
          const resolvedChatId = backingTask ? resolveTaskChatId(backingTask, chats) : undefined
          const isFollowing = Boolean(workerId && workerFollows.isFollowing(planning.task_id, workerId))
          const plan = plans.find((item) => item.planner_request_id === planning.request_id)
          const state = statusPresentation(planning.status)
          return <article key={planning.task_id} className={`relative border-b border-l-[3px] border-b-[var(--theme-border-soft)] px-4 py-4 last:border-b-0 hover:bg-[var(--theme-hover)] ${state.card}`}>
            {onSelect ? <button
              type="button"
              className="absolute inset-0 z-0 cursor-pointer border-0 bg-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
              aria-label={`Abrir detalhe de ${planning.objective || planning.request_id}`}
              onClick={() => onSelect(planning)}
            /> : null}
            <div className={`relative z-[1] grid grid-cols-[auto_minmax(0,1fr)] gap-3 ${onSelect ? 'pointer-events-none' : ''}`}>
              <span className={`mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-full ${state.marker}`} aria-hidden="true"><Icon name={state.icon} size={15}/></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <strong className="min-w-0 flex-1 text-lg font-semibold leading-[1.35] text-[var(--theme-text)] text-balance">{planning.objective || `Pedido ${planning.request_id}`}</strong>
                  <span className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-mono text-sm font-bold leading-none ${state.badge}`} title={`Estado ${planning.status}`}>
                    <Icon name={state.icon} size={12}/>{state.label}
                  </span>
                </div>
                <span className="mt-1 block break-words text-sm leading-[1.45] text-[var(--theme-text-muted)]">Request <code className="font-mono tabular-nums text-[var(--theme-text-soft)]" translate="no">{planning.request_id}</code> · tentativa {planning.attempt}/{planning.max_attempts}</span>
                {planning.last_error ? <small className="mt-1.5 block break-words text-sm leading-[1.45] text-[var(--theme-danger)]">{planning.last_error}</small> : <small className="mt-1.5 block break-words text-sm leading-[1.45] text-[var(--theme-text-muted)]">{['DONE', 'CANCELLED'].includes(planning.status) ? 'Planejamento encerrado.' : 'Pode sair do Orchestrator: um Worker continuará esta entrega.'}</small>}
                {(onSelect || (plan && onOpenTasks) || workerId || (resolvedChatId && onGoToChat) || ['FAILED', 'ATTENTION'].includes(planning.status)) && <div className={`mt-3 flex flex-wrap gap-2 ${onSelect ? 'pointer-events-auto' : ''}`}>
                  {onSelect ? <button className={actionClassName} type="button" onClick={(event) => { event.stopPropagation(); onSelect(planning) }} title="Ver o detalhe desta orquestração no painel lateral"><Icon name="info" size={13}/> Detalhes</button> : null}
                  {plan && onOpenTasks ? <button className={actionClassName} type="button" onClick={(event) => { event.stopPropagation(); onOpenTasks(plan.id) }} title="Abrir Tasks mostrando só as tasks desta orquestração"><Icon name="filter" size={13}/> Ver tasks</button> : null}
                  {workerId ? <button className={`${actionClassName} ${isFollowing ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] text-[var(--theme-text)]' : ''}`} type="button" aria-pressed={isFollowing} onClick={(event) => { event.stopPropagation(); workerFollows.toggle(planning.task_id, workerId) }} title="Acompanhar a instância do Worker que gera este plano numa janela separada"><Icon name="monitor" size={13}/> {isFollowing ? 'A acompanhar' : 'Acompanhar instância'}</button> : null}
                  {resolvedChatId && onGoToChat ? <button className={actionClassName} type="button" onClick={(event) => { event.stopPropagation(); onGoToChat(resolvedChatId, backingTask?.session_id) }} title="Abrir o chat Wharnex deste planeamento"><Icon name="bridge" size={13}/> Ver chat</button> : null}
                  {['FAILED', 'ATTENTION'].includes(planning.status) ? <button className={retryClassName} type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); onRetry(planning.request_id) }}><Icon name="refresh" size={13}/> Retentar</button> : null}
                </div>}
              </div>
            </div>
          </article>
        })}
      </div>
    </section>
  </>
}

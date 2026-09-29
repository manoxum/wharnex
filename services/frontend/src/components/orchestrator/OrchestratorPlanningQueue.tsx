import { useEffect, useState } from 'react'
import type { ChatAgentTask, OrchestratorOverview, OrchestratorPlan } from '../../types'
import { extractWorkerId, resolveTaskChatId, type ChatAgentTaskChatRef } from '../../lib/chatAgentTaskNav'
import { Icon } from '../Icon'
import { WorkerFollowViewer } from '../WorkerFollowViewer'

type PlanningRequest = OrchestratorOverview['planning_requests'][number]
type FollowedTask = { taskId: string; agentId: string }

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
  const [followed, setFollowed] = useState<FollowedTask>()
  const activeCount = requests.filter((item) => ['PENDING', 'LEASED', 'RUNNING', 'WAITING'].includes(item.status)).length
  const activeFollow = followed && requests.some((request) => request.task_id === followed.taskId && ['LEASED', 'RUNNING'].includes(request.status))
    && tasks.some((task) => task.task_id === followed.taskId && ['LEASED', 'RUNNING'].includes(task.status) && extractWorkerId(task.lease_owner) === followed.agentId)

  useEffect(() => {
    if (followed && !activeFollow) setFollowed(undefined)
  }, [followed, activeFollow])

  if (!requests.length) return null
  return <>
    <section className="orchestrator-planning-queue" aria-live="polite">
      <header>
        <div><span className="text-sm font-extrabold uppercase tracking-[0.08em] text-[var(--theme-accent)]">Fila durável</span><h2 className="m-0 text-lg">Em planejamento</h2></div>
        <strong className="font-mono text-sm font-semibold leading-[1.3] text-[var(--theme-text-muted)]">{activeCount} ativo{activeCount === 1 ? '' : 's'} · {requests.length} pedido{requests.length === 1 ? '' : 's'}</strong>
      </header>
      <div className="orchestrator-planning-list">
        {requests.map((planning) => {
          const backingTask = tasks.find((task) => task.task_id === planning.task_id)
          const workerId = backingTask && ['LEASED', 'RUNNING'].includes(backingTask.status) ? extractWorkerId(backingTask.lease_owner) : undefined
          const resolvedChatId = backingTask ? resolveTaskChatId(backingTask, chats) : undefined
          const isFollowing = followed?.taskId === planning.task_id && followed.agentId === workerId
          const plan = plans.find((item) => item.planner_request_id === planning.request_id)
          return <article
            key={planning.task_id}
            className={`orchestrator-planning-status status-${planning.status.toLowerCase()} ${onSelect ? 'relative' : ''}`}
          >
            {onSelect ? <button
              type="button"
              className="absolute inset-0 z-0 cursor-pointer border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]"
              aria-label={`Abrir detalhe de ${planning.objective || planning.request_id}`}
              onClick={() => onSelect(planning)}
            /> : null}
            <span className={`orchestrator-planning-pulse ${onSelect ? 'pointer-events-none relative z-[1]' : ''}`} aria-hidden="true"/>
            <div className={onSelect ? 'pointer-events-none relative z-[1]' : undefined}>
              <strong className="text-base text-balance">{planning.objective || `Pedido ${planning.request_id}`}</strong>
              <span className="break-words text-sm leading-[1.45] text-[var(--theme-text-muted)]">Request <code className="[font-family:inherit] tabular-nums text-[var(--theme-text-soft)]" translate="no">{planning.request_id}</code> · prioridade máxima · tentativa {planning.attempt}/{planning.max_attempts}</span>
              {planning.last_error ? <small className="break-words text-sm leading-[1.45] text-[var(--theme-text-muted)]">{planning.last_error}</small> : <small className="break-words text-sm leading-[1.45] text-[var(--theme-text-muted)]">{['DONE', 'CANCELLED'].includes(planning.status) ? 'Planejamento encerrado.' : 'Pode sair do Orchestrator: um Worker continuará esta entrega.'}</small>}
              {(onSelect || (plan && onOpenTasks) || workerId || (resolvedChatId && onGoToChat)) && <div className={`orchestrator-planning-nav ${onSelect ? 'pointer-events-auto' : ''}`}>
                {onSelect ? <button className="text-sm font-semibold" type="button" onClick={(event) => { event.stopPropagation(); onSelect(planning) }} title="Ver o detalhe desta orquestração no painel lateral"><Icon name="info" size={13}/> Detalhes</button> : null}
                {plan && onOpenTasks ? <button className="text-sm font-semibold" type="button" onClick={(event) => { event.stopPropagation(); onOpenTasks(plan.id) }} title="Abrir Tasks mostrando só as tasks desta orquestração"><Icon name="filter" size={13}/> Ver tasks</button> : null}
                {workerId ? <button className="text-sm font-semibold" type="button" aria-pressed={isFollowing} onClick={(event) => { event.stopPropagation(); setFollowed(isFollowing ? undefined : { taskId: planning.task_id, agentId: workerId }) }} title="Acompanhar a instância do Worker que gera este plano numa janela separada"><Icon name="monitor" size={13}/> {isFollowing ? 'A acompanhar' : 'Acompanhar instância'}</button> : null}
                {resolvedChatId && onGoToChat ? <button className="text-sm font-semibold" type="button" onClick={(event) => { event.stopPropagation(); onGoToChat(resolvedChatId, backingTask?.session_id) }} title="Abrir o chat Wharnex deste planeamento"><Icon name="bridge" size={13}/> Ver chat</button> : null}
              </div>}
            </div>
            <div className={`orchestrator-planning-actions ${onSelect ? 'pointer-events-none relative z-[1]' : ''}`}>
              <span className="orchestrator-planning-badge font-mono text-sm font-bold leading-none tracking-[0.04em]">{planning.status}</span>
              {['FAILED', 'ATTENTION'].includes(planning.status) ? <button className={`text-sm font-bold ${onSelect ? 'pointer-events-auto' : ''}`} type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); onRetry(planning.request_id) }}>Retentar</button> : null}
            </div>
          </article>
        })}
      </div>
    </section>
    {followed && activeFollow ? <WorkerFollowViewer agentId={followed.agentId} onStop={() => setFollowed(undefined)}/> : null}
  </>
}

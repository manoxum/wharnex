import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { taskBrowserAgentId, resolveTaskChatId, type ChatAgentTaskChatRef } from '../../lib/chatAgentTaskNav'
import { type ChatAgentTask, type OrchestratorPlanningDetail, type OrchestratorPlanningRequest, type OrchestratorTask } from '../../types'
import { Icon } from '../Icon'
import { WorkerFollowViewer } from '../WorkerFollowViewer'
import { OrchestratorPlanFilesTab, OrchestratorPlanTab } from './OrchestratorPlanDetailTabs'
import { OrchestratorPhaseBadge, OrchestratorPlanExecutionsTab, OrchestratorPlanProgressSummary } from './OrchestratorPlanRunSummary'

type DetailTab = 'summary' | 'files' | 'plan' | 'tasks' | 'executions'

const tabs: Array<{ id: DetailTab; label: string; icon: 'info' | 'folder' | 'plan' | 'list' | 'activity' }> = [
  { id: 'summary', label: 'Resumo', icon: 'info' },
  { id: 'files', label: 'Ficheiros', icon: 'folder' },
  { id: 'plan', label: 'Plano', icon: 'plan' },
  { id: 'tasks', label: 'Tasks', icon: 'list' },
  { id: 'executions', label: 'Execuções', icon: 'activity' },
]

// One look for every action of the drawer; colour carries meaning only
// together with the label (SoT/UI_UX.md).
const actionClass = 'inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-elevated)] px-3 text-sm font-semibold text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-hover)] disabled:cursor-default disabled:opacity-50'


export function OrchestratorPlanDrawer({ request, detail, planningTask, sessionId, chats = [], loading, busy = false, error, onClose, onRefresh, onSelectTask, onOpenTasks, onGoToChat, onRetry, onApprove, onReject, onRevise }: {
  request: OrchestratorPlanningRequest
  detail?: OrchestratorPlanningDetail
  planningTask?: ChatAgentTask
  // The owning session, where the planning bundles are kept.
  sessionId?: string
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
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const planID = detail?.plan?.id
  const requestStatus = detail?.status || request.status
  const workerID = taskBrowserAgentId(planningTask)
  const resolvedChatID = planningTask ? resolveTaskChatId(planningTask, chats) : undefined
  const canRetry = ['FAILED', 'ATTENTION'].includes(requestStatus)
  const canDecideDraft = detail?.plan?.status === 'DRAFT'

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setTab('summary')
    setFollowedWorker(undefined)
    closeButtonRef.current?.focus()
    return () => { if (previousFocus?.isConnected) previousFocus.focus() }
  }, [request.request_id])
  useEffect(() => {
    if (followedWorker && followedWorker !== workerID) setFollowedWorker(undefined)
  }, [followedWorker, workerID])

  return <div
    className="fixed inset-0 z-[1240] flex justify-end bg-[color-mix(in_srgb,var(--theme-backdrop)_65%,transparent)]"
    data-chatgpt-overlay-blocker="true"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
  >
    <aside
      className="grid h-full w-full max-w-[620px] grid-rows-[auto_minmax(0,1fr)] border-l border-[var(--theme-border)] bg-[var(--theme-surface)] shadow-[-20px_0_55px_var(--theme-shadow)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="orchestrator-plan-detail-title"
      aria-label={`Detalhe do planeamento ${request.request_id}`}
      onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
    >
      <header className="flex min-h-[62px] items-start justify-between gap-3 border-b border-[var(--theme-border-soft)] bg-[var(--theme-elevated)] px-4 py-3">
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate font-mono text-sm leading-[1.3] text-[var(--theme-text-soft)]">{request.request_id}</span>
          <strong id="orchestrator-plan-detail-title" className="truncate text-lg">{detail?.plan?.title || request.objective || 'Detalhe do planeamento'}</strong>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            <OrchestratorPhaseBadge phase={request.phase}/>
            <span className="text-sm text-[var(--theme-text-muted)]">Tentativa {detail?.attempt ?? request.attempt}/{detail?.max_attempts ?? request.max_attempts}</span>
          </span>
          <span className="text-sm text-[var(--theme-text-soft)]">Estado técnico do pedido: <code className="font-mono">{requestStatus}</code></span>
          <span className="text-sm text-[var(--theme-text-soft)]">Criado {formatDate(request.created_at)} · Atualizado {formatDate(request.updated_at)}</span>
          {detail?.plan ? <span className="truncate text-sm text-[var(--theme-text-soft)]"><span className="font-mono">{detail.plan.id}</span> · {detail.plan.title}</span> : null}
        </div>
        <span className="flex items-center gap-1">
          <button className="grid h-[30px] w-[30px] place-items-center rounded-md border-0 bg-transparent text-[var(--theme-text-muted)]" type="button" disabled={loading || busy} onClick={onRefresh} aria-label="Atualizar detalhe do planeamento" title="Atualizar"><Icon name="refresh" size={15}/></button>
          <button ref={closeButtonRef} className="grid h-[30px] w-[30px] place-items-center rounded-md border-0 bg-transparent text-[var(--theme-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)]" type="button" onClick={onClose} aria-label="Fechar detalhe do planeamento" title="Fechar"><Icon name="close" size={16}/></button>
        </span>
      </header>

      <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4" data-testid="orchestrator-plan-detail-scroll">
        <section className="mb-3 rounded-xl border border-[var(--theme-border-soft)] bg-[var(--theme-subtle)] p-3" aria-label="Ações do planeamento">
          <div className="flex flex-wrap gap-2">
            <button className={actionClass} type="button" onClick={() => void copyIdentifier(request.request_id)}><Icon name="copy" size={13}/> Copiar request_id</button>
            {planID ? <button className={actionClass} type="button" onClick={() => void copyIdentifier(planID)}><Icon name="copy" size={13}/> Copiar plan_id</button> : null}
            {resolvedChatID && onGoToChat ? <button className={actionClass} type="button" onClick={() => onGoToChat(resolvedChatID, planningTask?.session_id)}><Icon name="bridge" size={13}/> Abrir chat</button> : null}
            {workerID ? <button className={actionClass} type="button" aria-pressed={followedWorker === workerID} onClick={() => setFollowedWorker((current) => current === workerID ? undefined : workerID)}><Icon name="monitor" size={13}/> {followedWorker === workerID ? 'A acompanhar Worker' : 'Acompanhar Worker'}</button> : null}
            {planID && onOpenTasks ? <button className={actionClass} type="button" onClick={() => onOpenTasks(planID)}>Ver tasks</button> : null}
            {canRetry && onRetry ? <button className={actionClass} type="button" disabled={busy} onClick={onRetry}><Icon name="refresh" size={13}/> Retentar planeamento</button> : null}
          </div>
          {canDecideDraft && planID ? <div className="mt-2 flex flex-wrap gap-2 border-t border-[var(--theme-border-soft)] pt-2">
            {onReject ? <button className="rounded-md border border-[var(--theme-border)] bg-transparent px-2.5 py-1.5 text-sm font-semibold text-[var(--theme-danger)]" type="button" disabled={busy} onClick={() => onReject(planID)}><Icon name="close" size={13}/> Recusar plano</button> : null}
            {onRevise ? <button className="rounded-md border border-[var(--theme-border)] bg-transparent px-2.5 py-1.5 text-sm font-semibold" type="button" disabled={busy} onClick={() => onRevise(planID)}><Icon name="refresh" size={13}/> Pedir alteração</button> : null}
            {onApprove ? <button className="primary rounded-md px-2.5 py-1.5 text-sm font-semibold" type="button" disabled={busy} onClick={() => onApprove(planID)}><Icon name="check" size={13}/> Aprovar plano</button> : null}
          </div> : null}
        </section>

        {followedWorker ? <WorkerFollowViewer agentId={followedWorker} onStop={() => setFollowedWorker(undefined)}/> : null}

        <div className="sticky -top-3 z-[2] -mx-3 mt-1 flex gap-1 overflow-x-auto border-b border-[var(--theme-border-soft)] bg-[var(--theme-surface)] px-3 sm:-top-4 sm:-mx-4 sm:px-4" role="tablist" aria-label="Detalhe do planeamento">
          {tabs.map((item) => <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`-mb-px inline-flex min-h-10 shrink-0 items-center gap-1.5 border-x-0 border-t-0 border-b-2 bg-transparent px-2.5 text-sm font-semibold transition-colors ${tab === item.id ? 'border-[var(--theme-accent)] text-[var(--theme-text)]' : 'border-transparent text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'}`}
            onClick={() => setTab(item.id)}
          ><Icon name={item.icon} size={13}/>{item.label}</button>)}
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
          {tab === 'files' ? <OrchestratorPlanFilesTab detail={detail} sessionId={sessionId}/> : null}
          {tab === 'plan' ? <OrchestratorPlanTab detail={detail}/> : null}
          {tab === 'tasks' ? <TasksTab detail={detail}/> : null}
          {tab === 'executions' ? <OrchestratorPlanExecutionsTab detail={detail} onSelectTask={onSelectTask}/> : null}
        </div>}
      </div>
    </aside>
  </div>
}

function StateMessage({ kind, message }: { kind: 'loading' | 'empty' | 'info'; message: string }) {
  return <div className="mt-3 rounded-lg border border-dashed border-[var(--theme-border)] p-4 text-sm text-[var(--theme-text-muted)]" role={kind === 'loading' ? 'status' : undefined}>{message}</div>
}

const cardClass = 'rounded-xl border border-[var(--theme-border-soft)] bg-[var(--theme-subtle)] p-3'

function SummaryTab({ request, detail }: { request: OrchestratorPlanningRequest; detail: OrchestratorPlanningDetail }) {
  const objective = detail.objective || request.objective
  return <div className="grid gap-3">
    <OrchestratorPlanProgressSummary detail={detail} phase={request.phase}/>
    <section className={cardClass}>
      <strong className="text-base">Objetivo</strong>
      <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--theme-text-muted)]">{objective || 'Sem objetivo registrado.'}</p>
    </section>
    {detail.prompt ? <section className={cardClass}>
      <strong className="text-base">Prompt</strong>
      <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--theme-text-muted)]">{detail.prompt}</p>
    </section> : null}
    <section className={cardClass}>
      <strong className="text-base">Contexto do pedido</strong>
      <p className="mb-0 mt-1 text-sm text-[var(--theme-text-muted)]">{detail.include_context ? 'Contexto do projeto incluído.' : 'Contexto completo do projeto não incluído.'}</p>
    </section>
    {(detail.last_error || request.last_error) ? <section className={cardClass}>
      <strong className="text-base">Último erro</strong>
      <p className="mb-0 mt-1 whitespace-pre-wrap text-sm text-[var(--theme-danger)]">{detail.last_error || request.last_error}</p>
    </section> : null}
  </div>
}

function TasksTab({ detail }: { detail: OrchestratorPlanningDetail }) {
  const count = detail.tasks.length
  if (!count) return <StateMessage kind="empty" message="Nenhuma task foi criada para este plano."/>
  return <StateMessage kind="info" message={`${count} task${count === 1 ? '' : 's'} ${count === 1 ? 'disponível' : 'disponíveis'} para este plano.`}/>
}


function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (event.key === 'Escape') { onClose(); return }
  if (event.key !== 'Tab') return
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

async function copyIdentifier(value: string) {
  try { await navigator.clipboard?.writeText(value) } catch { /* clipboard is a convenience action; keep the detail usable if unavailable */ }
}

function formatDate(value: string) {
  try { return new Intl.DateTimeFormat('pt', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) } catch { return value }
}

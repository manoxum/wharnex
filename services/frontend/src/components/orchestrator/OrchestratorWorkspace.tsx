import { type ComponentProps, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errorMessage'
import { emptyOrchestratorTaskCounts, invalidateChangedOrchestratorTerminalPages, isOrchestratorTask, mergeOrchestratorTaskPages, reconcileOrchestratorTerminalPages } from '../../lib/orchestratorApi'
import { ORCHESTRATOR_TERMINAL_STATUSES, type ChatAgentTask, type OrchestratorOverview as OverviewData, type OrchestratorProposalResult, type OrchestratorTask, type OrchestratorTaskPageQuery, type OrchestratorTerminalTaskPages, type OrchestratorTerminalTaskStatus, type Session } from '../../types'
import { Icon } from '../Icon'
import { OrchestratorOverview } from './OrchestratorOverview'
import { OrchestratorTasks } from './OrchestratorTasks'
import { OrchestratorPlanDrawer } from './OrchestratorPlanDrawer'
import { useOrchestratorPlanningDetail } from './useOrchestratorPlanningDetail'
import type { ChatAgentTaskChatRef } from '../../lib/chatAgentTaskNav'
import { ChatPanel } from '../ChatPanel'

const TERMINAL_TASK_PAGE_SIZE = 24

export function OrchestratorWorkspace({ session, chats = [], chatProps, onGoToChat, focusNonce, active = true, bootstrapObjective = '', bootstrapIncludeContext = true, onBootstrapAccepted, onError }: {
  session: Session
  // Minimal id/sessionId pairs only: enough to resolve a planning request's
  // owning Harness chat without threading the full workspace-chat record in.
  chats?: ChatAgentTaskChatRef[]
  chatProps: ComponentProps<typeof ChatPanel>
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  // Bumped by the Tarefas drawer's "Ver orquestração" action so a task that
  // sent the operator here always lands back on the planning queue instead of
  // whichever section Orchestrator happened to be left on.
  focusNonce?: number
  // This workspace stays mounted (CSS-hidden) while another mode is active,
  // the same way EditorWorkspace does, so its local state (section, selected
  // task) survives switching away and back. Polling every 5s regardless kept
  // a network+render cost running forever for a panel the operator was not
  // looking at; only poll while it is actually the visible mode.
  active?: boolean
  bootstrapObjective?: string
  bootstrapIncludeContext?: boolean
  onBootstrapAccepted?: () => void
  onError: (message?: string) => void
}) {
  const [section, setSection] = useState<'overview' | 'tasks'>('overview')
  const [overview, setOverview] = useState<OverviewData>({ plans: [], tasks: [], task_counts: emptyOrchestratorTaskCounts(), planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 })
  const [terminalPages, setTerminalPages] = useState<OrchestratorTerminalTaskPages>({})
  const [proposal, setProposal] = useState<OrchestratorProposalResult>()
  const [selectedTask, setSelectedTask] = useState<OrchestratorTask>()
  const [planningTasks, setPlanningTasks] = useState<ChatAgentTask[]>([])
  const [busy, setBusy] = useState(false)
  const bootstrapPlanningRef = useRef(new Set<string>())
  const terminalLoadingRef = useRef(new Set<string>())

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true)
    try {
      const [nextOverview, nextTasks] = await Promise.all([
        api.orchestratorOverview(session.id),
        // The durable task carries the lease owner/chat/session identifiers a
        // planning request itself doesn't; one bulk fetch correlates every
        // visible planning request instead of one request per row. Scoped to
        // this project: the queue is shared, and the Overview it feeds only
        // ever shows this project's planning requests (adr/ADR-0044).
        api.chatAgentTasks(true, session.project_path).catch(() => ({ tasks: [] as ChatAgentTask[] })),
      ])
      setOverview(nextOverview)
      setTerminalPages((current) => invalidateChangedOrchestratorTerminalPages(current, nextOverview.task_counts))
      setPlanningTasks(nextTasks.tasks.filter((task) => task.type === 'ORCHESTRATOR_PLAN'))
    } catch (reason) { if (!quiet) onError(errorMessage(reason)) }
    finally { if (!quiet) setBusy(false) }
  }, [onError, session.id, session.project_path])

  const planningDetail = useOrchestratorPlanningDetail(session.id, overview.planning_requests)

  useEffect(() => {
    if (!active) return
    void refresh()
    const timer = window.setInterval(() => void refresh(true), 5000)
    return () => window.clearInterval(timer)
  }, [refresh, active])

  useEffect(() => {
    if (!focusNonce) return
    setSection('overview')
  }, [focusNonce])

  const loadTerminalPage = useCallback(async (status: OrchestratorTerminalTaskStatus, query: Omit<OrchestratorTaskPageQuery, 'status' | 'limit'> = {}) => {
    const key = `${status}:${query.q?.trim() || ''}:${query.cursor || ''}`
    if (terminalLoadingRef.current.has(key)) return undefined
    terminalLoadingRef.current.add(key)
    try {
      const page = await api.orchestratorTasks(session.id, { status, limit: TERMINAL_TASK_PAGE_SIZE, ...query })
      if (!query.q?.trim()) setTerminalPages((current) => ({
        ...current,
        [status]: query.cursor ? mergeOrchestratorTaskPages(current[status], page) : page,
      }))
      return page
    } catch (reason) { onError(errorMessage(reason)); return undefined }
    finally { terminalLoadingRef.current.delete(key) }
  }, [onError, session.id])

  useEffect(() => {
    if (!active || section !== 'tasks') return
    ORCHESTRATOR_TERMINAL_STATUSES.forEach((status) => { if (!terminalPages[status]) void loadTerminalPage(status) })
  }, [active, loadTerminalPage, section, terminalPages])

  useEffect(() => {
    const objective = bootstrapObjective.trim()
    if (!active || !objective) return
    const key = `${session.id}:${bootstrapIncludeContext ? 'context' : 'no-context'}:${objective}`
    if (bootstrapPlanningRef.current.has(key)) return
    bootstrapPlanningRef.current.add(key)
    setSection('overview')
    setBusy(true)
    onError(undefined)
    void api.proposeOrchestratorPlan(session.id, objective, { include_context: bootstrapIncludeContext })
      .then(async (value) => {
        setProposal(value)
        onBootstrapAccepted?.()
        await refresh(true)
      })
      .catch((reason) => {
        bootstrapPlanningRef.current.delete(key)
        onError(errorMessage(reason, 'Não foi possível iniciar o planeamento do novo projeto.'))
      })
      .finally(() => setBusy(false))
  }, [active, bootstrapIncludeContext, bootstrapObjective, onBootstrapAccepted, onError, refresh, session.id])

  async function run<T>(action: () => Promise<T>, after?: (value: T) => void) {
    setBusy(true); onError(undefined)
    try {
      const value = await action()
      if (isOrchestratorTask(value)) setTerminalPages((current) => reconcileOrchestratorTerminalPages(current, value))
      after?.(value)
      await refresh(true)
      return value
    } catch (reason) {
      onError(errorMessage(reason))
      return undefined
    } finally { setBusy(false) }
  }

  const navButtonClass = 'flex min-h-[30px] items-center gap-2 rounded-md border-0 bg-transparent px-3.5 text-base text-[var(--theme-text-muted)] cursor-pointer'

  return <section className="orchestrator-workspace">
    <header className="orchestrator-header">
      <div>
        <span className="orchestrator-eyebrow inline-flex items-center gap-1.5 text-base font-bold text-[var(--theme-text)]"><Icon name="plan" size={14}/> Orchestrator</span>
        <strong className="truncate text-sm font-semibold text-[var(--theme-text-muted)]">Objetivos em fluxo executável</strong>
      </div>
      <nav aria-label="Orchestrator">
        <button className={`${navButtonClass} ${section === 'overview' ? 'active' : ''}`} onClick={() => setSection('overview')}>Overview</button>
        <button className={`${navButtonClass} ${section === 'tasks' ? 'active' : ''}`} onClick={() => setSection('tasks')}>Tasks <span className="min-w-[18px] rounded-full bg-[var(--theme-subtle)] px-1.5 py-px font-mono text-sm leading-[1.4] text-[var(--theme-text-soft)]">{Object.values(overview.task_counts).reduce((total, count) => total + count, 0)}</span></button>
      </nav>
      <button className="orchestrator-refresh" type="button" onClick={() => void refresh()} disabled={busy} aria-label="Atualizar Orchestrator"><Icon name="refresh" size={15}/></button>
    </header>

    {section === 'overview' ? <OrchestratorOverview
      session={session}
      overview={overview}
      planningTasks={planningTasks}
      chats={chats}
      chatProps={chatProps}
      onGoToChat={onGoToChat}
      onError={onError}
      proposal={proposal}
      busy={busy}
      onProposal={setProposal}
      onRun={run}
      onOpenTasks={() => setSection('tasks')}
      onSelectTask={(task) => { setSelectedTask(task); setSection('tasks') }}
      onSelectPlanningRequest={planningDetail.open}
    /> : <OrchestratorTasks
      session={session}
      overview={overview}
      terminalPages={terminalPages}
      chatProps={chatProps}
      selectedTask={selectedTask}
      busy={busy}
      onSelectedTask={setSelectedTask}
      onLoadTerminalPage={loadTerminalPage}
      onRun={run}
    />}

    {planningDetail.request ? <OrchestratorPlanDrawer
      request={planningDetail.request}
      detail={planningDetail.detail}
      loading={planningDetail.loading}
      error={planningDetail.error}
      onClose={planningDetail.close}
      onRefresh={planningDetail.refresh}
      onSelectTask={(task) => { planningDetail.close(); setSelectedTask(task); setSection('tasks') }}
    /> : null}
  </section>
}

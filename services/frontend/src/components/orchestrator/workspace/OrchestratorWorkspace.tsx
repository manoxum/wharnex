import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../../lib/transport/http/api'
import { errorMessage } from '../../../lib/workspace/dialogs/errorMessage'
import { promptDialog } from '../../../lib/desktop/bridge/appDialog'
import { emptyOrchestratorTaskCounts, invalidateChangedOrchestratorTerminalPages, isOrchestratorTask, mergeOrchestratorTaskPages, reconcileOrchestratorTerminalPages } from '../../../lib/orchestrator/coordination/orchestratorApi'
import { ORCHESTRATOR_TERMINAL_STATUSES, type ChatAgentTask, type OrchestratorOverview as OverviewData, type OrchestratorProposalResult, type OrchestratorTask, type OrchestratorTaskPageQuery, type OrchestratorTerminalTaskPages, type OrchestratorTerminalTaskStatus } from '../../../types'
import { OrchestratorHeader } from './OrchestratorHeader'
import { WorkerFollowViewer } from '../../agent/runtime/WorkerFollowViewer'
import { OrchestratorOverview } from '../overview/OrchestratorOverview'
import { OrchestratorTasks } from '../tasks/OrchestratorTasks'
import { OrchestratorPlanDrawer } from '../planning/OrchestratorPlanDrawer'
import { useOrchestratorPlanningDetail } from '../planning/useOrchestratorPlanningDetail'
import { useOrchestratorTaskFocus } from '../tasks/useOrchestratorTaskFocus'
import type { OrchestratorWorkspaceProps } from './OrchestratorWorkspace.types.ts'
import { OrchestratorWorkerFollowProvider, useOrchestratorWorkerFollows } from './useOrchestratorWorkerFollows'

const TERMINAL_TASK_PAGE_SIZE = 24

export function OrchestratorWorkspace({ session, chats = [], chatProps, onGoToChat, focusNonce, focusTaskId, focusTaskNonce, active = true, bootstrapObjective = '', bootstrapIncludeContext = true, onBootstrapAccepted, onError }: OrchestratorWorkspaceProps) {
  const [section, setSection] = useState<'overview' | 'tasks'>('overview')
  const [overview, setOverview] = useState<OverviewData>({ plans: [], tasks: [], task_counts: emptyOrchestratorTaskCounts(), planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 })
  const [terminalPages, setTerminalPages] = useState<OrchestratorTerminalTaskPages>({})
  const [proposal, setProposal] = useState<OrchestratorProposalResult>()
  const [selectedTask, setSelectedTask] = useState<OrchestratorTask>()
  const [planFilter, setPlanFilter] = useState<string>()
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
      return nextOverview
    } catch (reason) { if (!quiet) onError(errorMessage(reason)); return undefined }
    finally { if (!quiet) setBusy(false) }
  }, [onError, session.id, session.project_path])

  const planningDetail = useOrchestratorPlanningDetail(session.id, overview.planning_requests)
  const workerFollows = useOrchestratorWorkerFollows(overview.planning_requests, planningTasks)

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

  useOrchestratorTaskFocus({
    active, focusTaskId, focusTaskNonce, tasks: overview.tasks,
    refresh,
    setSection,
    setPlanFilter,
    setSelectedTask,
  })

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

  async function runPlanningAction<T>(action: () => Promise<T>, after?: (value: T) => void) {
    const value = await run(action, after)
    if (value !== undefined) planningDetail.refresh()
    return value
  }

  async function revisePlanningDetail(planID: string) {
    if (busy) return
    const guidance = await promptDialog({
      title: 'Pedir alteração do plano',
      message: 'Descreva o que deve mudar. O Wharnex enviará o plano proposto atual como anexo para o Planner gerar uma nova versão.',
      inputLabel: 'Alteração pretendida',
      placeholder: 'Ex.: dividir a tarefa de migração e acrescentar uma etapa de rollback',
      confirmLabel: 'Pedir alteração',
      validate: (value) => value.trim() ? undefined : 'Descreva a alteração pretendida.',
    })
    if (guidance === undefined) return
    await runPlanningAction(
      () => api.reviseOrchestratorPlan(session.id, planID, guidance.trim()),
      (value) => setProposal(value),
    )
  }

  return <OrchestratorWorkerFollowProvider registry={workerFollows}><section className="orchestrator-workspace @container/orchestration grid min-h-0 min-w-0 flex-1 grid-rows-[40px_minmax(0,1fr)] overflow-hidden bg-whx-bg text-base text-whx-text">
    <OrchestratorHeader section={section} count={Object.values(overview.task_counts).reduce((total, count) => total + count, 0)} busy={busy} onSection={setSection} onRefresh={() => void refresh()}/>

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
      onOpenTasks={() => { setPlanFilter(undefined); setSection('tasks') }}
      onOpenPlanTasks={(planID) => { setPlanFilter(planID); setSection('tasks') }}
      onSelectTask={(task) => { setPlanFilter(undefined); setSelectedTask(task); setSection('tasks') }}
      onSelectPlanningRequest={planningDetail.open}
    /> : <OrchestratorTasks
      session={session}
      overview={overview}
      terminalPages={terminalPages}
      chatProps={chatProps}
      selectedTask={selectedTask}
      planFilter={planFilter}
      busy={busy}
      onSelectedTask={setSelectedTask}
      onPlanFilterChange={setPlanFilter}
      onLoadTerminalPage={loadTerminalPage}
      onRun={run}
    />}

    {workerFollows.follows.map((follow) => <WorkerFollowViewer
      key={`${follow.taskId}:${follow.agentId}`}
      agentId={follow.agentId}
      onStop={() => workerFollows.stop(follow.taskId, follow.agentId)}
    />)}

    {planningDetail.request ? <OrchestratorPlanDrawer
      request={planningDetail.request}
      detail={planningDetail.detail}
      planningTask={planningTasks.find((task) => task.task_id === (planningDetail.detail?.task_id || planningDetail.request?.task_id))}
      sessionId={session.id}
      chats={chats}
      loading={planningDetail.loading}
      busy={busy}
      error={planningDetail.error}
      onClose={planningDetail.close}
      onRefresh={planningDetail.refresh}
      onGoToChat={onGoToChat}
      onRetry={() => { void runPlanningAction(() => api.retryOrchestratorPlanning(session.id, planningDetail.request!.request_id)) }}
      onApprove={(planID) => { void runPlanningAction(() => api.approveOrchestratorPlan(session.id, planID), () => { if (proposal?.plan?.id === planID) setProposal(undefined) }) }}
      onReject={(planID) => { void runPlanningAction(() => api.rejectOrchestratorPlan(session.id, planID), () => { if (proposal?.plan?.id === planID) setProposal(undefined) }) }}
      onRevise={(planID) => { void revisePlanningDetail(planID) }}
      onSelectTask={(task) => { planningDetail.close(); setPlanFilter(undefined); setSelectedTask(task); setSection('tasks') }}
      onOpenTasks={(planID) => {
        setPlanFilter(planID)
        setSelectedTask(undefined)
        setSection('tasks')
        planningDetail.close()
      }}
    /> : null}
  </section></OrchestratorWorkerFollowProvider>
}

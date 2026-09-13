import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errorMessage'
import type { ChatAgentTask, OrchestratorOverview as OverviewData, OrchestratorProposalResult, OrchestratorTask, Session } from '../../types'
import { Icon } from '../Icon'
import { OrchestratorOverview } from './OrchestratorOverview'
import { OrchestratorTasks } from './OrchestratorTasks'
import type { ChatAgentTaskChatRef } from '../../lib/chatAgentTaskNav'

export function OrchestratorWorkspace({ session, chats = [], onGoToChat, focusNonce, onError }: {
  session: Session
  // Minimal id/sessionId pairs only: enough to resolve a planning request's
  // owning Harness chat without threading the full workspace-chat record in.
  chats?: ChatAgentTaskChatRef[]
  onGoToChat?: (chatId?: string, sessionId?: string) => void
  // Bumped by the Tarefas drawer's "Ver orquestração" action so a task that
  // sent the operator here always lands back on the planning queue instead of
  // whichever section Orchestrator happened to be left on.
  focusNonce?: number
  onError: (message?: string) => void
}) {
  const [section, setSection] = useState<'overview' | 'tasks'>('overview')
  const [overview, setOverview] = useState<OverviewData>({ plans: [], tasks: [], planning_requests: [], mutation_slots: 1, mutation_slots_used: 0 })
  const [proposal, setProposal] = useState<OrchestratorProposalResult>()
  const [selectedTask, setSelectedTask] = useState<OrchestratorTask>()
  const [planningTasks, setPlanningTasks] = useState<ChatAgentTask[]>([])
  const [busy, setBusy] = useState(false)

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
      setPlanningTasks(nextTasks.tasks.filter((task) => task.type === 'ORCHESTRATOR_PLAN'))
    } catch (reason) { if (!quiet) onError(errorMessage(reason)) }
    finally { if (!quiet) setBusy(false) }
  }, [onError, session.id, session.project_path])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(true), 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    if (!focusNonce) return
    setSection('overview')
  }, [focusNonce])

  async function run<T>(action: () => Promise<T>, after?: (value: T) => void) {
    setBusy(true); onError(undefined)
    try {
      const value = await action()
      after?.(value)
      await refresh(true)
      return value
    } catch (reason) {
      onError(errorMessage(reason))
      return undefined
    } finally { setBusy(false) }
  }

  return <section className="orchestrator-workspace">
    <header className="orchestrator-header">
      <div>
        <span className="orchestrator-eyebrow"><Icon name="plan" size={14}/> Orchestrator</span>
        <strong>Objetivos em fluxo executável</strong>
      </div>
      <nav aria-label="Orchestrator">
        <button className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}>Overview</button>
        <button className={section === 'tasks' ? 'active' : ''} onClick={() => setSection('tasks')}>Tasks <span>{overview.tasks.filter((task) => task.status !== 'ARCHIVED').length}</span></button>
      </nav>
      <button className="orchestrator-refresh" type="button" onClick={() => void refresh()} disabled={busy} aria-label="Atualizar Orchestrator"><Icon name="refresh" size={15}/></button>
    </header>

    {section === 'overview' ? <OrchestratorOverview
      session={session}
      overview={overview}
      planningTasks={planningTasks}
      chats={chats}
      onGoToChat={onGoToChat}
      onError={onError}
      proposal={proposal}
      busy={busy}
      onProposal={setProposal}
      onRun={run}
      onOpenTasks={() => setSection('tasks')}
      onSelectTask={(task) => { setSelectedTask(task); setSection('tasks') }}
    /> : <OrchestratorTasks
      session={session}
      overview={overview}
      selectedTask={selectedTask}
      busy={busy}
      onSelectedTask={setSelectedTask}
      onRun={run}
    />}
  </section>
}

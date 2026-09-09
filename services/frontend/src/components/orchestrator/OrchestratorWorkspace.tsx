import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/errorMessage'
import type { OrchestratorOverview as OverviewData, OrchestratorProposalResult, OrchestratorTask, Session } from '../../types'
import { Icon } from '../Icon'
import { OrchestratorOverview } from './OrchestratorOverview'
import { OrchestratorTasks } from './OrchestratorTasks'

export function OrchestratorWorkspace({ session, onError }: { session: Session; onError: (message?: string) => void }) {
  const [section, setSection] = useState<'overview' | 'tasks'>('overview')
  const [overview, setOverview] = useState<OverviewData>({ plans: [], tasks: [], mutation_slots: 1, mutation_slots_used: 0 })
  const [proposal, setProposal] = useState<OrchestratorProposalResult>()
  const [selectedTask, setSelectedTask] = useState<OrchestratorTask>()
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setBusy(true)
    try { setOverview(await api.orchestratorOverview(session.id)) }
    catch (reason) { if (!quiet) onError(errorMessage(reason)) }
    finally { if (!quiet) setBusy(false) }
  }, [onError, session.id])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(true), 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

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

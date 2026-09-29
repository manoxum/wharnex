import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import type { HarnessEvent, OrchestratorTask, OrchestratorTaskRun, Session } from '../../types'

// A task is one agentic Main Request per run: each run owns an Agent Session
// whose bundles, plans and executions are read exactly as a chat reads its own.
export function useOrchestratorTaskRun(sessionId: string, task: OrchestratorTask) {
  const [runs, setRuns] = useState<OrchestratorTaskRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [agent, setAgent] = useState<Session>()
  const [events, setEvents] = useState<HarnessEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const live = task.status === 'DOING'

  useEffect(() => {
    let alive = true
    const load = () => void api.orchestratorTaskRuns(sessionId, task.id).then((value) => { if (alive) setRuns(value.runs) }).catch(() => undefined)
    load()
    const timer = live ? window.setInterval(load, 15_000) : undefined
    return () => { alive = false; if (timer) window.clearInterval(timer) }
  }, [sessionId, task.id, task.updated_at, live])

  useEffect(() => { setSelectedRunId(undefined) }, [task.id])

  const ordered = useMemo(() => [...runs].sort((a, b) => b.attempt - a.attempt || b.started_at.localeCompare(a.started_at)), [runs])
  const run = ordered.find((item) => item.id === selectedRunId) || ordered[0]
  const agentSessionId = run?.session_id || ''

  useEffect(() => {
    if (!agentSessionId) { setAgent(undefined); setEvents([]); return }
    let alive = true
    const load = (first: boolean) => {
      if (first) { setLoading(true); setError('') }
      void Promise.all([api.getSession(agentSessionId), api.eventHistory(agentSessionId, true)]).then(([session, history]) => {
        if (!alive) return
        setAgent(session)
        setEvents(history.events || [])
      }).catch((reason) => {
        if (alive && first) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a execução.')
      }).finally(() => { if (alive && first) setLoading(false) })
    }
    load(true)
    const timer = live ? window.setInterval(() => load(false), 15_000) : undefined
    return () => { alive = false; if (timer) window.clearInterval(timer) }
  }, [agentSessionId, live])

  return { runs: ordered, run, selectRun: setSelectedRunId, agent, events, loading, error }
}

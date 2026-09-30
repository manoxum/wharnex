import type { ExecutionPlan, ExecutionResult, HarnessEvent, Session } from '../../../types'
import type { WorkspaceChat } from '../../chat/history/workspaceMemory'

export type ProjectSessionActivity = { chat: WorkspaceChat; session: Session }

export type MainRequestActivityGroup = {
  rootRequestId: string
  requestIds: string[]
  planIds: string[]
  updatedAt: string
  events: HarnessEvent[]
}

export function mainRequestRoot(session: Session, requestId: string) {
  if (!requestId) return ''
  return session.request_lineages?.[requestId]?.root_request_id || requestId
}

export function mergeAuditEvents(history: HarnessEvent[], live: HarnessEvent[]) {
  const merged = new Map<string, HarnessEvent>()
  for (const event of history) merged.set(event.id, event)
  for (const event of live) merged.set(event.id, event)
  return [...merged.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

// A session is long-lived while a Main Request is the human audit boundary.
// Durable events are therefore grouped by root request rather than by the
// renderer's bounded live window. Events such as command.output often carry
// only run/plan identity, so the last explicit lineage remains the correlation
// context until the next rooted event starts.
export function groupMainRequestActivity(session: Session, events: HarnessEvent[]): MainRequestActivityGroup[] {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const requestByPlan = new Map<string, string>()
  if (session.plan?.plan_id) requestByPlan.set(session.plan.plan_id, session.plan.request_id)
  for (const change of [...(session.pending_host_changes || []), ...(session.last_applied_changes || [])]) {
    requestByPlan.set(change.plan.plan_id, change.plan.request_id)
  }
  for (const event of sorted) {
    const planId = String(event.data?.plan_id || '')
    const plan = event.data?.plan as ExecutionPlan | undefined
    const requestId = String(event.data?.request_id || plan?.request_id || '')
    if (planId && requestId) requestByPlan.set(planId, requestId)
    if (plan?.plan_id && plan.request_id) requestByPlan.set(plan.plan_id, plan.request_id)
  }

  const groups = new Map<string, { events: HarnessEvent[]; requests: Set<string>; plans: Set<string>; updatedAt: string }>()
  let activeRoot = ''
  for (const event of sorted) {
    const planId = String(event.data?.plan_id || '')
    const requestId = String(event.data?.request_id || requestByPlan.get(planId) || '')
    const explicitRoot = String(event.data?.root_request_id || '')
    const root = explicitRoot || mainRequestRoot(session, requestId) || activeRoot
    if (!root) continue
    if (explicitRoot || requestId) activeRoot = root
    const group = groups.get(root) || { events: [], requests: new Set<string>(), plans: new Set<string>(), updatedAt: event.timestamp }
    group.events.push(event)
    if (requestId) group.requests.add(requestId)
    if (planId) group.plans.add(planId)
    if (event.timestamp > group.updatedAt) group.updatedAt = event.timestamp
    groups.set(root, group)
  }

  return [...groups].map(([rootRequestId, group]) => ({
    rootRequestId, requestIds: [...group.requests], planIds: [...group.plans], updatedAt: group.updatedAt, events: group.events,
  })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export type ProjectSessionLoadResult = { sessions: Record<string, Session>; failed: number }

export async function loadProjectSessions(
  sessionIds: string[],
  loadSession: (id: string) => Promise<Session>,
  concurrency = 4,
): Promise<ProjectSessionLoadResult> {
  const unique = [...new Set(sessionIds.filter(Boolean))]
  const sessions: Record<string, Session> = {}
  let failed = 0
  let cursor = 0
  const workers = Math.min(unique.length, Math.max(1, concurrency))

  async function worker() {
    while (cursor < unique.length) {
      const index = cursor++
      const id = unique[index]
      try { sessions[id] = await loadSession(id) }
      catch { failed++ }
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()))
  return { sessions, failed }
}
export type PlanActivityItem = {
  id: string
  chatId: string
  chatTitle: string
  label: string
  timestamp: string
  plan: ExecutionPlan
  session: Session
}
export type ExecutionActivityItem = {
  id: string
  chatId: string
  chatTitle: string
  timestamp: string
  requestId: string
  execution: ExecutionResult
  session: Session
}

// Durable ledger records (`plan.recorded` / `execution.recorded`) carry the full
// body the session snapshot throws away. The snapshot keeps one current plan and
// one last execution, and several lifecycle transitions clear both, so without
// these the Plans and Executions views showed only whatever the session happened
// to be holding — which is why restarting Wharnex appeared to reset them.
export function ledgerPlanActivities(chat: WorkspaceChat, session: Session, events: HarnessEvent[]): PlanActivityItem[] {
  const items: PlanActivityItem[] = []
  for (const event of events) {
    if (event.type !== 'plan.recorded') continue
    const plan = event.data?.plan as ExecutionPlan | undefined
    if (!plan?.plan_id) continue
    items.push({
      id: `${chat.id}:${plan.plan_id}`, chatId: chat.id, chatTitle: chat.title,
      label: 'Registado', timestamp: event.timestamp, plan, session,
    })
  }
  return items
}

export function ledgerExecutionActivities(chat: WorkspaceChat, session: Session, events: HarnessEvent[]): ExecutionActivityItem[] {
  const items: ExecutionActivityItem[] = []
  for (const event of events) {
    if (event.type !== 'execution.recorded') continue
    const execution = event.data?.execution as ExecutionResult | undefined
    if (!execution?.plan_id) continue
    items.push({
      id: `${chat.id}:${execution.plan_id}:${execution.started_at || event.timestamp}`,
      chatId: chat.id, chatTitle: chat.title, timestamp: execution.started_at || event.timestamp,
      requestId: String(event.data?.request_id || ''), execution, session,
    })
  }
  return items
}

export function collectPlanActivities(entries: ProjectSessionActivity[], ledger: Record<string, HarnessEvent[]> = {}): PlanActivityItem[] {
  const items = new Map<string, PlanActivityItem>()
  for (const { chat, session } of entries) {
    // The durable ledger goes in first so a live snapshot entry, which carries
    // the richer label ("Aplicado no host"), overwrites the plain record.
    for (const item of ledgerPlanActivities(chat, session, ledger[chat.id] || [])) items.set(item.id, item)
    const current = session.plan ? [{ plan: session.plan, timestamp: session.last_execution?.plan_id === session.plan.plan_id ? session.last_execution.started_at : session.created_at, label: 'Plano atual' }] : []
    const pending = (session.pending_host_changes || []).map((change) => ({ plan: change.plan, timestamp: change.verified_at, label: 'Verificado · pendente no host' }))
    const applied = (session.last_applied_changes || []).map((change) => ({ plan: change.plan, timestamp: change.verified_at, label: 'Aplicado no host' }))
    for (const candidate of [...current, ...pending, ...applied]) {
      const id = `${chat.id}:${candidate.plan.plan_id}`
      const previous = items.get(id)
      if (!previous || candidate.timestamp > previous.timestamp) items.set(id, {
        id, chatId: chat.id, chatTitle: chat.title, label: candidate.label,
        timestamp: candidate.timestamp, plan: candidate.plan, session,
      })
    }
  }
  return [...items.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export function collectExecutionActivities(entries: ProjectSessionActivity[], ledger: Record<string, HarnessEvent[]> = {}): ExecutionActivityItem[] {
  const items = new Map<string, ExecutionActivityItem>()
  for (const { chat, session } of entries) {
    for (const item of ledgerExecutionActivities(chat, session, ledger[chat.id] || [])) items.set(item.id, item)
    const requestByPlan = new Map<string, string>()
    if (session.plan) requestByPlan.set(session.plan.plan_id, session.plan.request_id)
    for (const change of [...(session.pending_host_changes || []), ...(session.last_applied_changes || [])]) {
      requestByPlan.set(change.plan.plan_id, change.plan.request_id)
    }
    const executions = [
      session.last_execution,
      ...(session.pending_host_changes || []).map((change) => change.execution),
      ...(session.last_applied_changes || []).map((change) => change.execution),
    ].filter((value): value is ExecutionResult => Boolean(value))
    for (const execution of executions) {
      const id = `${chat.id}:${execution.plan_id}:${execution.started_at}`
      items.set(id, {
        id, chatId: chat.id, chatTitle: chat.title, timestamp: execution.started_at,
        requestId: requestByPlan.get(execution.plan_id) || '', execution, session,
      })
    }
  }
  return [...items.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

export function executionAuditEvents(events: HarnessEvent[], item: ExecutionActivityItem): HarnessEvent[] {
  const planID = item.execution.plan_id
  const requestID = item.requestId
  return events.filter((event) => {
    const eventPlanID = String(event.data.plan_id || '')
    const eventRequestID = String(event.data.request_id || '')
    const rootRequestID = String(event.data.root_request_id || '')
    return eventPlanID === planID || Boolean(requestID && (eventRequestID === requestID || rootRequestID === requestID))
  })
}

export function filterAuditEvents(events: HarnessEvent[], query: string): HarnessEvent[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return events
  return events.filter((event) => {
    let data = ''
    try { data = JSON.stringify(event.data) || '' } catch { data = String(event.data) }
    return `${event.type} ${event.id} ${event.timestamp} ${data}`.toLocaleLowerCase().includes(needle)
  })
}

export function sessionForPlan(item: PlanActivityItem): Session {
  const current = item.session.plan?.plan_id === item.plan.plan_id
  return {
    ...item.session,
    plan: item.plan,
    policy: current ? item.session.policy : undefined,
    last_bundle: current ? item.session.last_bundle : undefined,
    last_turn: current ? item.session.last_turn : undefined,
    workflow_round: current ? item.session.workflow_round : undefined,
  }
}

export function executionEventsFromResult(result: ExecutionResult, sessionId: string): HarnessEvent[] {
  const events: HarnessEvent[] = [{
    id: `${result.plan_id}:start`, session_id: sessionId, type: 'execution.started', timestamp: result.started_at,
    data: { plan_id: result.plan_id },
  }]
  result.commands.forEach((command, index) => {
    const runID = `${result.plan_id}:command:${index}`
    events.push({
      id: `${runID}:start`, session_id: sessionId, type: 'command.started', timestamp: result.started_at,
      data: { run_id: runID, argv: command.argv, cwd: command.cwd },
    })
    events.push({
      id: `${runID}:completed`, session_id: sessionId, type: 'command.completed', timestamp: result.completed_at,
      data: {
        run_id: runID, argv: command.argv, cwd: command.cwd, exit_code: command.exit_code,
        duration_ms: command.duration_ms, success: command.success, stdout: command.stdout, stderr: command.stderr,
        baseline_diagnostic: command.baseline_output,
      },
    })
  })
  events.push({
    id: `${result.plan_id}:finish`, session_id: sessionId,
    type: result.success ? 'execution.completed' : 'execution.failed', timestamp: result.completed_at,
    data: { plan_id: result.plan_id, success: result.success, error: result.error || '' },
  })
  return events
}

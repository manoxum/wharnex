import type { ExecutionPlan, ExecutionResult, HarnessEvent, Session } from '../../../types'

// Rebuild from bounded/redacted ledger bodies when live output events expire.
// This projection creates UI evidence only; it cannot execute or approve work.
export function projectExecutionEvidence(events: HarnessEvent[], session?: Session): HarnessEvent[] {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const plans = new Map<string, ExecutionPlan>()
  for (const event of sorted) {
    const plan = event.data.plan as ExecutionPlan | undefined
    if (event.type === 'plan.recorded' && plan?.plan_id) plans.set(plan.plan_id, plan)
  }
  if (session?.plan) plans.set(session.plan.plan_id, session.plan)
  const workflowPlans = new Set(sorted.filter((event) => event.type === 'workflow.started').map((event) => String(event.data.plan_id || '')))
  const records = sorted.filter((event) => event.type === 'execution.recorded')
  if (session?.last_execution && !records.some((event) => sameExecution(event.data.execution as ExecutionResult | undefined, session.last_execution!))) {
    const execution = session.last_execution
    records.push({ id: `snapshot:${execution.plan_id}:${execution.started_at}`, session_id: session.id, type: 'execution.recorded', timestamp: execution.completed_at || execution.started_at, data: { execution, plan_id: execution.plan_id } })
  }
  let planId = ''
  const normalized: HarnessEvent[] = sorted.map((event) => {
    if (event.data.plan_id) planId = String(event.data.plan_id)
    const owner = plans.get(String(event.data.plan_id || planId))
    const requestId = String(event.data.request_id || owner?.request_id || '')
    const request = requestId === owner?.plan_id ? owner.request_id : requestId
    return { ...event, data: { ...event.data, ...(planId ? { plan_id: event.data.plan_id || planId } : {}), ...(request ? { request_id: request } : {}), ...(session?.request_lineages?.[request] ? { root_request_id: session.request_lineages[request].root_request_id, iteration_kind: session.request_lineages[request].kind } : {}) } }
  })
  const seen = new Set<string>()
  for (const event of records) {
    const execution = event.data.execution as ExecutionResult | undefined
    if (!execution?.plan_id) continue
    const key = `${execution.plan_id}:${execution.started_at}`
    if (seen.has(key)) continue
    seen.add(key)
    const plan = plans.get(execution.plan_id)
    const request = String(plan?.request_id || event.data.request_id || '')
    const lineage = session?.request_lineages?.[request]
    const data = { plan_id: execution.plan_id, request_id: request, root_request_id: lineage?.root_request_id || event.data.root_request_id || request, iteration_kind: lineage?.kind || event.data.iteration_kind || (plan?.debug || workflowPlans.has(execution.plan_id) ? 'evidence' : 'standard') }
    const completed = normalized.filter((candidate) => candidate.type === 'command.completed' && inExecution(candidate, execution))
    const started = normalized.filter((candidate) => candidate.type === 'command.started' && inExecution(candidate, execution))
    const used = new Set<string>()
    for (const [index, command] of (execution.commands || []).entries()) {
      const match = [...completed, ...started].find((candidate) => !used.has(String(candidate.data.run_id || candidate.id)) && signature(candidate.data) === signature(command))
      const runId = String(match?.data.run_id || match?.id || `ledger:${key}:command:${index}`)
      used.add(runId)
      const spec = plan?.operations?.filter((op) => op.type === 'command')[index]?.command || plan?.verification?.[index - (plan?.operations?.filter((op) => op.type === 'command').length || 0)]
      normalized.push({ ...event, id: `${event.id}:command:${index}`, type: 'command.completed', timestamp: execution.completed_at || event.timestamp, data: { ...data, ...command, run_id: runId, recorded_result: true, rationale: match?.data.rationale || spec?.rationale || plan?.debug?.rationale || '', target: match?.data.target || (plan?.debug ? `debug-${plan.debug.target}` : undefined) } })
    }
    for (const operation of execution.interactive || []) {
      if (normalized.some((candidate) => candidate.type === 'interactive.operation_completed' && candidate.data.operation_id === operation.operation_id)) continue
      normalized.push({ ...event, id: `${event.id}:operation:${operation.operation_id}`, type: 'interactive.operation_completed', timestamp: operation.completed_at || event.timestamp, data: { ...data, ...operation, capability: operation.capability || operation.type } })
    }
    const recordIndex = normalized.findIndex((candidate) => candidate.id === event.id)
    const record = { ...event, data: { ...event.data, ...data, success: execution.success } }
    if (recordIndex < 0) normalized.push(record)
    else normalized[recordIndex] = record
  }
  return [...new Map(normalized.map((event) => [event.id, event])).values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function signature(command: { argv?: unknown; cwd?: unknown }) { return JSON.stringify([command.argv || [], command.cwd || '.']) }
function sameExecution(a: ExecutionResult | undefined, b: ExecutionResult) { return a?.plan_id === b.plan_id && a.started_at === b.started_at }
function inExecution(event: HarnessEvent, execution: ExecutionResult) {
  const time = Date.parse(event.timestamp)
  return event.data.plan_id === execution.plan_id && time >= Date.parse(execution.started_at) && time <= Date.parse(execution.completed_at || event.timestamp)
}

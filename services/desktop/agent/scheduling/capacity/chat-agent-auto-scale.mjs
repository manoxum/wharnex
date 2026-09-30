import { workerSuspensionState } from './chat-agent-policies.mjs'

// Only work the Worker claim may take can justify another browser renderer.
// A partial operator suspension excludes named types, while a full suspension
// excludes every type. The backend provides exact due counts by type so a
// suspended backlog cannot inflate the pool.
export function autoScaleWorkerDemand(queue, policies) {
  const suspension = workerSuspensionState(policies)
  if (!suspension.paused) return Math.max(0, Number(queue?.due_worker) || 0)
  if (suspension.task_types.length === 0) return 0
  const excluded = new Set(suspension.task_types)
  return Object.entries(queue?.due_worker_by_type || {}).reduce((due, [type, count]) =>
    due + (excluded.has(type) ? 0 : Math.max(0, Number(count) || 0)), 0)
}

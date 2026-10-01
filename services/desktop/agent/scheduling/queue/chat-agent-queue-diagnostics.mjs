// Projects the backend's queue aggregate onto the runtime diagnostics shape.
//
// The numbers that matter operationally are `due` and `scheduled`. A task
// deferred behind its own not_before — every bundle-retention cleanup is
// deferred for days by design — is waiting on a clock, not on a worker, so
// counting it as pending backlog makes a completely idle queue read as a
// stuck one. `oldest_due_created_at` ages only claimable work for the same
// reason: a task that is early is not late.
export function chatAgentQueueDiagnostics(summary = {}) {
  const counts = {}
  for (const [status, count] of Object.entries(summary?.counts || {})) {
    counts[String(status).toUpperCase()] = Math.max(0, Number(count) || 0)
  }
  return {
    queued: Math.max(0, Number(summary?.queued) || 0),
    counts,
    due: Math.max(0, Number(summary?.due) || 0),
    // Role-partitioned demand. Each pool is sized from its own half: the shared
    // total would grow the Supervisor pool because a library cleanup is queued,
    // and grow the Worker pool because a conversation is being supervised.
    due_supervisor_lanes: Math.max(0, Number(summary?.due_supervisor_lanes) || 0),
    due_worker: Math.max(0, Number(summary?.due_worker) || 0),
    due_translator: Math.max(0, Number(summary?.due_translator) || 0),
    scheduled: Math.max(0, Number(summary?.scheduled) || 0),
    guarded: Math.max(0, Number(summary?.guarded) || 0),
    blocked: Math.max(0, Number(summary?.blocked) || 0),
    oldest_due_created_at: String(summary?.oldest_due_created_at || ''),
    next_not_before: String(summary?.next_not_before || ''),
  }
}

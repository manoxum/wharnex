// ExecutionConcurrency is how many plans one project may verify at a time,
// plus the ceiling the backend clamps to. Raising it is not free: each
// concurrent runner claims a full container memory allowance and a complete
// project clone.
export type ExecutionConcurrency = {
  concurrency: number
  max: number
}

export type ChatAgentTask = {
  task_id: string
  type: string
  source?: string
  project_id: string
  chat_id: string
  session_id: string
  request_id: string
  root_request_id: string
  conversation_id: string
  parent_task_id: string
  plan_id?: string
  title?: string
  description?: string
  condition?: string
  priority: number
  status: 'PENDING' | 'LEASED' | 'RUNNING' | 'WAITING' | 'DONE' | 'FAILED' | 'ATTENTION' | 'CANCELLED' | string
  not_before: string
  attempt: number
  max_attempts: number
  dedupe_key: string
  assigned_worker: string
  keep_flowing: boolean
  lease_owner: string
  lease_expires_at?: string
  payload: unknown
  last_error: string
  created_at: string
  updated_at: string
}

// One durable decision recorded against a chat-agent task's own lifecycle
// (recovery reload, keep-continue wake-up, bundle validated/rejected, human
// escalation, manual/automatic continuation). See adr/ADR-0064.
export type ChatAgentTaskEvent = {
  id: string
  task_id: string
  request_id: string
  root_request_id: string
  session_id: string
  chat_id: string
  project_id: string
  type: string
  occurred_at: string
  data: Record<string, unknown>
}

export type ChatAgentQueueSummary = {
  queued: number
  counts: Record<string, number>
  due: number
  due_supervisor_lanes?: number
  due_worker?: number
  due_translator?: number
  scheduled: number
  guarded: number
  blocked: number
  oldest_due_created_at?: string
  next_not_before?: string
  // Active tasks outside the requested project, reported only as a count: the
  // pool is shared, so an empty local queue is not an idle pool.
  other_projects?: number
}

export type BundleQuota = {
  window_hours: number
  limit: number
  sent: number
  received: number
  total: number
  warning: boolean
  window_start: string
  window_end: string
}

export type HarnessEvent = {
  id: string
  session_id: string
  type: string
  timestamp: string
  data: Record<string, unknown>
  project_path?: string
  project_name?: string
  category?: string
}

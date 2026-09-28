import type { EffortLevel, ReasoningEffort } from '../types'

export const ORCHESTRATOR_TASK_STATUSES = ['PENDING', 'WAITING', 'READY', 'DOING', 'REVIEW', 'FAILED', 'COMPLETE', 'ARCHIVED'] as const
export const ORCHESTRATOR_TERMINAL_STATUSES = ['COMPLETE', 'ARCHIVED'] as const

export type OrchestratorPlanStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'
export type OrchestratorTaskStatus = (typeof ORCHESTRATOR_TASK_STATUSES)[number]
export type OrchestratorTerminalTaskStatus = (typeof ORCHESTRATOR_TERMINAL_STATUSES)[number]
export type OrchestratorTaskCondition = 'none' | 'dependency' | 'plan_approval' | 'manual_pause' | 'missing_context' | 'approval' | 'conflict' | 'failed_run' | 'stale_dependency'
export type OrchestratorPriority = 'low' | 'normal' | 'high' | 'urgent'

export type OrchestratorPlan = {
  id: string; project_path: string; title: string; objective: string; status: OrchestratorPlanStatus
  planner_request_id?: string; assumptions?: string[]; created_at: string; updated_at: string
}

export type OrchestratorTask = {
  id: string; project_path: string; plan_id?: string; title: string; description?: string; acceptance_criteria?: string[]
  status: OrchestratorTaskStatus; condition: OrchestratorTaskCondition; priority: OrchestratorPriority; depends_on?: string[]
  capability?: string; complexity?: string; parallelizable: boolean; impact_files?: string[]; read_files?: string[]; barrier_files?: string[]
  reasoning_effort?: ReasoningEffort; effort_level?: EffortLevel; retry_context?: OrchestratorTaskRetryContext
  was_completed?: boolean; allowed_transitions?: OrchestratorTaskStatus[]; created_at: string; updated_at: string
}

export type OrchestratorTaskRetryContext = {
  guidance?: string; project_files?: string[]; attachment_cache_key?: string
  attachments?: Array<{ name: string; size: number; mime: string; storage_ref: string }>
}

export type OrchestratorTaskRun = {
  id: string; task_id: string; project_path: string; session_id?: string; request_id?: string; execution_plan_id?: string
  attempt: number; status: string; error?: string; started_at: string; completed_at?: string
}

export type OrchestratorPlanningRequest = {
  request_id: string; task_id: string; objective?: string; status: string; attempt: number; max_attempts: number; last_error?: string; created_at: string; updated_at: string
}

export type OrchestratorTaskCounts = Record<OrchestratorTaskStatus, number>
export type OrchestratorOverview = {
  plans: OrchestratorPlan[]; tasks: OrchestratorTask[]; task_counts: OrchestratorTaskCounts
  planning_requests: OrchestratorPlanningRequest[]; mutation_slots: number; mutation_slots_used: number
}
export type OrchestratorTaskPage = { tasks: OrchestratorTask[]; total: number; next_cursor?: string; has_more: boolean }
export type OrchestratorTaskPageQuery = { status?: OrchestratorTerminalTaskStatus; q?: string; limit?: number; cursor?: string }
export type OrchestratorTerminalTaskPages = Partial<Record<OrchestratorTerminalTaskStatus, OrchestratorTaskPage>>

export type OrchestratorProposalTask = {
  id: string; title: string; description: string; acceptance_criteria: string[]; depends_on: string[]; priority: OrchestratorPriority
  capability: string; complexity: 'low' | 'medium' | 'high'; parallelizable: boolean; impact_files: string[]; read_files: string[]; barrier_files: string[]
}

export type OrchestratorProposal = { protocol: 'harness.orchestrator-plan/v1'; title: string; objective: string; assumptions: string[]; tasks: OrchestratorProposalTask[] }
export type OrchestratorProposalResult = { request_id: string; plan?: OrchestratorPlan; tasks?: OrchestratorTask[]; manual_prompt?: string; worker_task_id?: string; delivery_status?: string }
export type OrchestratorRunResult = { task: OrchestratorTask; run: OrchestratorTaskRun; manual_prompt?: string }

import type { ArtifactRecord } from '../artifacts/catalog'
import type { ReasoningEffort } from '../runtime/operation'

export type OrchestratorPlanningAttachment = {
  name: string
  size?: number
  mime?: string
  generated?: boolean
}

export type OrchestratorPlanningAttempt = {
  task_id: string
  status: string
  attempt: number
  max_attempts: number
  last_error?: string
  created_at: string
  updated_at: string
}

export type OrchestratorPlanningInput = {
  objective?: string
  prompt?: string
  include_context: boolean
  project_files: string[]
  attachments: OrchestratorPlanningAttachment[]
  reasoning_effort?: ReasoningEffort
}

export type OrchestratorPlanningTaskDetail = {
  task: import('../orchestrator').OrchestratorTask
  runs: import('../orchestrator').OrchestratorTaskRun[]
}

export type OrchestratorPlanningDetail = OrchestratorPlanningInput & {
  request_id: string
  task_id?: string
  status?: string
  attempt?: number
  max_attempts?: number
  last_error?: string
  attempts: OrchestratorPlanningAttempt[]
  plan?: import('../orchestrator').OrchestratorPlan
  tasks: OrchestratorPlanningTaskDetail[]
  // The request and response ZIPs exchanged with ChatGPT for this plan.
  bundles?: ArtifactRecord[]
}

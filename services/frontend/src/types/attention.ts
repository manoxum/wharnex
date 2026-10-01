import type { OrchestratorTaskStatus } from './orchestrator'

export type OrchestratorTaskConclusion = {
  run_id: string
  task_id: string
  title: string
  status: Extract<OrchestratorTaskStatus, 'REVIEW' | 'COMPLETE' | 'ARCHIVED'>
  completed_at: string
}

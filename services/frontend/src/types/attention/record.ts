import type { Session } from '../agent/session'
import type { ActivationImpact } from '../artifacts/catalog'
import type { ExecutionMode } from '../execution/approval'

// One chat's attention inputs, without the megabyte of session payload the
// attention center never reads. See /api/workspace-attention.
export type AttentionRecord = {
  session_id: string
  chat_id: string
  state: string
  execution_mode?: ExecutionMode
  failure_kind?: string
  last_request_id?: string
  last_repair_error?: string
  last_turn?: Session['last_turn']
  policy?: Session['policy']
  has_plan: boolean
  plan_id?: string
  plan_request_id?: string
  has_plan_document?: boolean
  debug_target?: 'sandbox' | 'host'
  debug_access?: 'observe' | 'modify'
  debug_rationale?: string
  last_execution_plan_id?: string
  pending_host_changes: number
  pending_manual_requests?: number
  planner_in_flight?: boolean
  has_manual_prompt?: boolean
  self_evolution?: boolean
  self_evolution_activation?: Session['self_evolution_activation']
  self_evolution_impacts?: ActivationImpact[]
  last_host_applied_at?: string
  pending_knowledge_review_request_id?: string
  integration_conflict?: { id: string; path_count: number }
  interrupted_execution?: { plan_id: string; status: string }
}

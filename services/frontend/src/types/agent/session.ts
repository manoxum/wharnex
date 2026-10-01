import type { AgentTurn, ContextMode } from './turn'
import type { ActivationImpact, ArtifactRecord } from '../artifacts/catalog'
import type { ChatRequestMode } from '../chat/request'
import type { ContextManifest } from '../context/inventory'
import type { ExecutionMode } from '../execution/approval'
import type { ApprovedChatPlan, BaselineNotice, CommandResult, ExecutionPlan, ExecutionResult, IntegrationConflict, InteractiveScope, PendingHostChange, PolicyDecision } from '../execution/contracts'
import type { AutomationMode, ChatTransportMode, EffortLevel, ReasoningEffort } from '../runtime/operation'

export type Session = {
  id: string
  project_path: string
  related_project_paths?: string[]
  /** The frontend chat id this session is scoped to, propagated at session
   *  creation. Empty for a session created before chat-id propagation
   *  existed — the frontend MUST backfill it (api.setChatId) once it
   *  notices the mismatch, or every derived-request bundle filename falls
   *  back to a "system" placeholder that can never match the real active
   *  chat and permanently fails bundle validation for that session. */
  chat_id?: string
  execution_mode: ExecutionMode
  automation_mode: AutomationMode
  debug_enabled?: boolean
  debug_approved_root_request_id?: string
  debug_approved_plan_id?: string
  interactive_grant?: { protocol: 'harness.interactive/v2'; policy_revision: string; root_request_id: string; plan_id?: string; access: 'observe' | 'modify'; target: 'sandbox' | 'host'; capabilities: string[]; scope: InteractiveScope; digest: string; one_shot: boolean; granted_at: string }
  approved_chat_plan?: ApprovedChatPlan
  execution_approved_root_request_id?: string
  approved_execution_boundary_keys?: string[]
  effort_level?: EffortLevel
  reasoning_effort?: ReasoningEffort
  context_mode?: ContextMode
  context_paths?: string[]
  automation_attempt?: number
  improvement_attempt?: number
  chat_transport_mode?: ChatTransportMode
  knowledge_sharing_enabled?: boolean
  knowledge_last_seen_revision?: number
  last_main_request_summary?: string
  self_evolution?: boolean
	wharnex_instance_id?: string
  self_evolution_activation?: 'restart_pending' | 'restart_scheduled'
  self_evolution_impacts?: ActivationImpact[]
  state: string
  created_at: string
  context: {
    id: string
    manifest: ContextManifest
    workspace_sha256?: string
    related_projects?: Array<{ project_path: string; name: string; prefix: string; manifest: ContextManifest }>
    attachments?: Array<{ root: string; name: string; kind: string; prefix: string; files: number; bytes: number; included_paths?: string[] }>
  }
  plan?: ExecutionPlan
  plan_control?: { plan_id: string; state: 'active' | 'paused' | 'suspended'; updated_at: string }
  policy?: PolicyDecision
  last_execution?: ExecutionResult
  pending_host_changes?: PendingHostChange[]
  last_applied_changes?: PendingHostChange[]
  last_reverted_changes?: PendingHostChange[]
  last_host_commands?: CommandResult[]
  last_host_applied_at?: string
  last_manual_prompt?: string
  last_request_id?: string
  pending_manual_request_ids?: string[]
  /** An in-flight post-apply knowledge_review round, independent of
   *  `state`: the apply that triggered it already succeeded and `state`
   *  already reflects that. Auto mode delivers `last_manual_prompt`
   *  automatically when this is set, same as repair/conflict, but keyed on
   *  this field instead of `state` so it never competes with those. */
  pending_knowledge_review_request_id?: string
  last_bundle?: { filename: string; readme: string; files: string[]; patches: string[]; sha256: string }
  last_turn?: AgentTurn
  repair_attempt?: number
  repair_parent_plan_id?: string
  last_repair_error?: string
  /** Wharnex's own closed-set classification of the last terminal failure
   *  (e.g. 'offline_go_module_cache'). Recovery affordances MUST key on this
   *  field, never on last_repair_error/last_turn text — that prose is free
   *  form and can be rephrased or come from an external planner. */
  failure_kind?: string
  workflow_round?: number
  last_request_mode?: ChatRequestMode | 'approve_plan' | 'correct_plan' | 'adjust_plan'
  planner_in_flight?: boolean
  request_baselines?: Record<string, string>
  baseline_notices?: BaselineNotice[]
  integration_conflict?: IntegrationConflict
  artifacts?: ArtifactRecord[]
  interrupted_execution?: { plan_id: string; requested_at: string; approved: boolean; status?: 'awaiting_decision' | 'running' | 'resuming' | 'failed_retryable'; last_error?: string }
  remote_recovery_attempt?: number
	request_lineages?: Record<string, { request_id: string; root_request_id: string; parent_request_id?: string; kind: 'standard' | 'plan_approval' | 'plan_correction' | 'execution_plan_adjustment' | 'repair' | 'revert_restore' | 'plan_reversal' | 'improvement' | 'evidence' | 'conflict' | 'knowledge_review' | 'knowledge_consolidation'; created_at: string }>
  /** Set the instant a chat's session is archived; null once restored. Set
   *  together, restore is a pure state flip (api.restoreChat) while it is
   *  still within the grace window (see compacted_at). */
  archived_at?: string
  /** Set once the passive compaction sweep has folded this session's
   *  artifacts/events/context archives into archive_package (ADR-0031).
   *  While set, api.restoreChat performs the slower extract-and-restore
   *  path instead of a plain state flip. */
  compacted_at?: string
  archive_package?: { sha256: string; size: number; entry_count: number; created_at: string }
}

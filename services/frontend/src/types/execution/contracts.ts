import type { Session } from '../agent/session'
import type { ExecutionApproval } from './approval'
import type { GitConflictContext } from '../git/changes'

export type CommandSpec = {
  argv: string[]
  cwd: string
  timeout_seconds: number
  network: boolean
  expected_exit_codes: number[]
  rationale?: string
}

export type InteractiveScope = {
  paths?: string[]
  connections?: string[]
  log_sources?: string[]
  processes?: string[]
  services?: string[]
  containers?: string[]
  network_destinations?: string[]
}

export type Operation = {
  type: 'apply_patch' | 'command' | 'shell' | 'sql' | 'logs' | 'filesystem' | 'process' | 'network' | 'container' | 'service'
  patch?: string
  rationale?: string
  command?: CommandSpec
  shell?: { script: string; shell: 'bash'; cwd: string; timeout_seconds: number; network: boolean; env_allowlist?: string[] }
  sql?: { connection_id: string; statement: string; mode: 'read_only' | 'write'; timeout_seconds: number; max_rows: number }
  logs?: { source: string; path?: string; unit?: string; container?: string; since?: string; until?: string; limit: number; filter?: string }
  filesystem?: { action: 'list' | 'stat' | 'read' | 'write' | 'remove' | 'rename'; path: string; content?: string; max_bytes?: number }
  process?: { action: 'list' | 'signal'; pid?: number; signal?: string }
  network?: { action: 'connect'; address: string; timeout_seconds: number }
  container?: { action: 'inspect' | 'logs' | 'restart' | 'exec'; name: string; argv?: string[]; tail?: number; timeout_seconds?: number }
  service?: { action: 'status' | 'restart'; name: string }
}

export type ExecutionPlan = {
  protocol: 'harness.execution/v1' | 'harness.execution/v2'
  base_context_sha256?: string
  impact_files?: string[]
  read_files?: string[]
  barrier_files?: string[]
  plan_id: string
  request_id: string
  status: 'ready' | 'blocked'
  summary: string
  document?: string
  dependencies?: Array<{ scope: string; manager: string; name: string; version?: string; action: 'install' | 'update' | 'remove' | 'use'; reason: string }>
  system_tools?: Array<{ target: 'sandbox' | 'host'; name: string; action: 'install' | 'update' | 'configure' | 'use'; lifetime?: 'temporary' | 'persistent'; reason: string }>
  approved_chat_plan?: ApprovedChatPlan
  debug?: { protocol: 'harness.debug/v1' | 'harness.interactive/v1' | 'harness.interactive/v2'; target: 'sandbox' | 'host'; access?: 'observe' | 'modify'; query?: 'project_execution_summary'; capabilities?: Array<'command' | 'shell' | 'sql' | 'logs' | 'filesystem' | 'process' | 'network' | 'container' | 'service'>; scope?: InteractiveScope; rationale: string }
  risk: 'low' | 'medium' | 'high'
  requires_approval: boolean
  operations: Operation[]
  verification: CommandSpec[]
}

export type ApprovedChatPlan = { protocol: 'harness.chat-plan/v1'; request_id: string; sha256: string; document: string }

export type PolicyDecision = {
  allowed: boolean
  requires_approval: boolean
  risk: 'low' | 'medium' | 'high'
  reasons: string[]
  approval_items?: ExecutionApproval[]
}

export type CommandResult = {
  argv: string[]
  cwd: string
  exit_code: number
  stdout: string
  stderr: string
  duration_ms: number
  success: boolean
  baseline_failure?: boolean
  baseline_exit_code?: number
  baseline_output?: string
}

export type ExecutionErrorLog = {
  kind: string
  argv?: string[]
  cwd?: string
  exit_code?: number
  stdout?: string
  stderr?: string
  operation_id?: string
  operation_type?: string
  output?: string
  error?: string
  duration_ms?: number
}

export type ExecutionErrorSolution = { request_id: string; plan_id: string; summary: string; commit_message?: string }

export type ExecutionErrorRecord = {
  id: string
  session_id: string
  chat_id: string
  root_request_id?: string
  request_id?: string
  plan_id?: string
  stage: string
  error: string
  cause?: string
  failure_kind?: string
  status_code?: number
  logs: ExecutionErrorLog[]
  status: 'open' | 'resolved'
  gpt_solution?: ExecutionErrorSolution
  occurred_at: string
  resolved_at?: string
  updated_at: string
}

export type ExecutionResult = {
  plan_id: string
  success: boolean
  started_at: string
  completed_at: string
  commands: CommandResult[]
  interactive?: Array<{ operation_id: string; type: string; capability: string; target: string; status: string; started_at: string; completed_at: string; output?: string; error?: string; truncated?: boolean; redacted?: boolean; bytes?: number; rows?: number }>
  error?: string
  warnings?: string[]
}

export type BaselineNotice = {
  id: string
  source_session_id: string
  source_plan_id: string
  previous_sha256: string
  new_sha256: string
  changed_files: string[]
  overlap_files?: string[]
  relevant: boolean
  complete_delta?: boolean
  created_at: string
}

export type PendingHostChange = {
  plan: ExecutionPlan
  execution: ExecutionResult
  verified_at: string
  change_set?: ChangeSet
  integration_branch?: string
  integration_commit?: string
  submodule_integrations?: Array<{
    path: string
    branch: string
    commit: string
    target_branch?: string
    base_commit?: string
  }>
}

export type IntegrationOutcome = 'planning' | 'verified' | 'merging' | 'checking' | 'ready' | 'integrated' | 'conflict' | 'semantic_recheck' | 'retryable_race'
export type FileMutation = { path: string; base_sha256?: string; result_sha256?: string; base_exists: boolean; result_exists: boolean; base_mode?: number; result_mode?: number }
export type ChangeSet = { id: string; base_revision: string; mutations: FileMutation[]; read_files?: string[]; barrier_files?: string[]; state: IntegrationOutcome; created_at: string }
export type IntegrationConflict = { id: string; request_id: string; original_plan_ids: string[]; paths: string[]; details: Array<{ change_set_id: string; path: string; reason: string }>; created_at: string; manual_paths?: string[]; git?: GitConflictContext }
export type ConflictWorkbenchFile = { path: string; base_exists: boolean; current_exists: boolean; incoming_exists: boolean; base: string; current: string; incoming: string }
export type ConflictWorkbench = { id: string; request_id: string; files: ConflictWorkbenchFile[]; manual_paths?: string[] }
export type ConflictManualResolution = { path: string; content: string; exists: boolean }
export type ConflictManualResult = { session: Session; applied: boolean }

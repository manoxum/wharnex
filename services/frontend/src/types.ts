export type CommandSpec = {
  argv: string[]
  cwd: string
  timeout_seconds: number
  network: boolean
  expected_exit_codes: number[]
}

export type Operation = {
  type: 'apply_patch' | 'command'
  patch: string
  command: CommandSpec
}

export type ExecutionPlan = {
  protocol: 'harness.execution/v1'
  plan_id: string
  request_id: string
  status: 'ready' | 'blocked'
  summary: string
  risk: 'low' | 'medium' | 'high'
  requires_approval: boolean
  operations: Operation[]
  verification: CommandSpec[]
}

export type PolicyDecision = {
  allowed: boolean
  requires_approval: boolean
  risk: 'low' | 'medium' | 'high'
  reasons: string[]
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

export type ExecutionResult = {
  plan_id: string
  success: boolean
  started_at: string
  completed_at: string
  commands: CommandResult[]
  error?: string
  warnings?: string[]
}

export type PendingHostChange = {
  plan: ExecutionPlan
  execution: ExecutionResult
  verified_at: string
}

export type ContextExclusion = { path: string; kind: string; reason: string; rule: string }

export type ContextManifest = {
  id: string
  project_root: string
  sha256: string
  files: Array<{ path: string; size: number; sha256: string }>
  excluded: string[]
  excluded_details?: ContextExclusion[]
  text_truncated: boolean
}

export type ContextRule = {
  id: string
  source: string
  label: string
  enabled: boolean
  patterns: string[]
  description: string
}

export type ContextInventoryEntry = {
  path: string
  kind: string
  status: 'included' | 'excluded' | string
  size?: number
  reason?: string
  rule?: string
}

export type ContextRootEntry = {
  path: string
  name: string
  kind: 'file' | 'directory' | string
  status: 'included' | 'excluded' | 'partial' | 'not-in-snapshot' | string
  included_files: number
  excluded_items: number
  included_bytes: number
  reason?: string
}

export type ContextInspection = {
  snapshot_id: string
  sha256: string
  project_root: string
  included_files: number
  excluded_items: number
  included_bytes: number
  roots: ContextRootEntry[]
  entries: ContextInventoryEntry[]
  rules: ContextRule[]
}

export type ExecutionMode = 'protected' | 'unprotected'
export type AutomationMode = 'manual' | 'auto'
export type TerminalTarget = 'sandbox' | 'host'

export type TurnKind = 'answer' | 'clarification' | 'investigation' | 'workflow' | 'change' | 'blocked'

export type AgentTurn = {
  protocol: 'harness.turn/v1'
  request_id: string
  kind: TurnKind
  message: string
}

export type Session = {
  id: string
  project_path: string
  execution_mode: ExecutionMode
  automation_mode: AutomationMode
  self_evolution?: boolean
  self_evolution_activation?: 'restart_pending' | 'restart_scheduled'
  state: string
  created_at: string
  context: { id: string; manifest: ContextManifest }
  plan?: ExecutionPlan
  policy?: PolicyDecision
  last_execution?: ExecutionResult
  pending_host_changes?: PendingHostChange[]
  last_applied_changes?: PendingHostChange[]
  last_manual_prompt?: string
  last_request_id?: string
  pending_manual_request_ids?: string[]
  last_bundle?: { filename: string; readme: string; files: string[]; patches: string[]; sha256: string }
  last_turn?: AgentTurn
  repair_attempt?: number
  repair_parent_plan_id?: string
  last_repair_error?: string
  workflow_round?: number
  last_request_mode?: ChatRequestMode
}

export type HarnessEvent = {
  id: string
  session_id: string
  type: string
  timestamp: string
  data: Record<string, unknown>
}

export type AppConfig = {
  planner: 'manual' | 'openai' | string
  sandbox: 'docker' | 'local' | string
  model: string
  api_configured: boolean
  chatgpt_web_embed: boolean
}

export type FileEntry = {
  path: string
  name: string
  kind: 'file' | 'directory'
  size: number
}

export type WorkspaceFile = {
  path: string
  content: string
  sha256: string
  size: number
}


export type ProjectConfig = {
  version: number
  project: { name: string }
  context: {
    auto_exclude: boolean
    max_file_bytes: number
    include: string[]
    exclude: string[]
  }
}

export type ProjectProvision = {
  project_path: string
  config_file: string
  submodules?: string
}

export type WorkspaceMode = 'editor' | 'agent'

export type ChatArtifactKind = 'context' | 'prompt' | 'result' | 'error'
export type ChatArtifactSelection = Record<ChatArtifactKind, boolean>
export type ChatRequestMode = 'direct' | 'plan_first'
export type QueuedChatRequest = {
  id: string
  message: string
  attachments: File[]
  artifacts: ChatArtifactSelection
  requestMode: ChatRequestMode
  createdAt: string
}
export type ChatItemSource = 'user' | 'chatgpt' | 'wharness'
export type ChatItemPresentation = 'message' | 'notice' | 'thought' | 'plan' | 'change'
export type ChatPlanApproval = { status: 'pending' | 'approved' | 'rejected'; originalMessage: string; requestId: string }
export type ChatChangeFile = { path: string; additions: number; deletions: number; diff: string }
export type ChatChangeSummary = { planId: string; files: ChatChangeFile[]; appliedAt: string; reverted?: boolean; canRevert: boolean }
export type ChatGPTActivity = { cacheKey?: string; state: 'idle' | 'thinking'; text: string; capturedAt: string }
export type ChatIterationRef = {
  id: string
  requestId: string
  phase: 'outbound' | 'prepared' | 'submitted' | 'workflow' | 'repair' | 'result' | 'failed'
  artifacts: ChatArtifactKind[]
  chatgptUrl?: string
}

export type ChatAttachmentInfo = {
  name: string
  size: number
  mime?: string
  storageRef?: string
  previewKind?: 'thumbnail' | 'icon' | 'none'
}

export type ChatItem = { id: string; role: 'user' | 'harness'; text: string; createdAt?: string; meta?: string; turnKind?: TurnKind; attachments?: ChatAttachmentInfo[]; iteration?: ChatIterationRef; source?: ChatItemSource; presentation?: ChatItemPresentation; approval?: ChatPlanApproval; change?: ChatChangeSummary }

export type BundleSubmission = { session: Session; auto_executed: boolean; auto_applied: boolean; auto_error?: string; execution?: ExecutionResult; policy_blocked?: boolean; policy_reasons?: string[]; repair_prepared?: boolean; workflow_executed?: boolean; workflow_prepared?: boolean; workflow_round?: number; restart_scheduled?: boolean; restart_required?: boolean }

export type ProjectStorageUsage = { project_path: string; session_count: number; context_bytes: number; sandbox_bytes: number; total_bytes: number }
export type BackendStorageUsage = { total_bytes: number; state_bytes: number; context_bytes: number; sandbox_bytes: number; orphan_bytes: number; projects: ProjectStorageUsage[] }

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
  base_context_sha256?: string
  impact_files?: string[]
  read_files?: string[]
  barrier_files?: string[]
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
}

export type IntegrationOutcome = 'planning' | 'verified' | 'merging' | 'checking' | 'ready' | 'integrated' | 'conflict' | 'semantic_recheck' | 'retryable_race'
export type FileMutation = { path: string; base_sha256?: string; result_sha256?: string; base_exists: boolean; result_exists: boolean; base_mode?: number; result_mode?: number }
export type ChangeSet = { id: string; base_revision: string; mutations: FileMutation[]; read_files?: string[]; barrier_files?: string[]; state: IntegrationOutcome; created_at: string }
export type IntegrationConflict = { id: string; request_id: string; original_plan_ids: string[]; paths: string[]; details: Array<{ change_set_id: string; path: string; reason: string }>; created_at: string }

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
/** Scraper: Desktop drives the embedded ChatGPT DOM directly, as it always
 *  has. Manual: Desktop never touches that DOM — the prompt is only shown
 *  for copy/paste and a response bundle is only imported by explicit human
 *  upload. Independent of AutomationMode; Auto + Manual is valid. */
export type ChatTransportMode = 'scraper' | 'manual'
export type TerminalTarget = 'sandbox' | 'host'

export type TurnKind = 'answer' | 'clarification' | 'investigation' | 'workflow' | 'change' | 'blocked'

export type AgentTurn = {
  protocol: 'harness.turn/v1'
  request_id: string
  kind: TurnKind
  message: string
  outcome?: { status: 'completed' | 'failed' | 'partial'; reason_code?: string; message?: string; retryable: boolean }
}

export type ProjectKnowledgeEntry = {
  id: string
  content: string
  version: number
  updated_at: string
  updated_by_request_id?: string
}

export type ProjectKnowledgeCatalog = {
  project_path: string
  revision: number
  entries: ProjectKnowledgeEntry[]
  updated_at: string
  updated_by_request_id?: string
}

export type ProjectKnowledge = {
  project_path: string
  content: string
  version: number
  updated_at: string
  updated_by_request_id?: string
}

export type Session = {
  id: string
  project_path: string
  /** The frontend chat id this session is scoped to, propagated at session
   *  creation. Empty for a session created before chat-id propagation
   *  existed — the frontend MUST backfill it (api.setChatId) once it
   *  notices the mismatch, or every derived-request bundle filename falls
   *  back to a "system" placeholder that can never match the real active
   *  chat and permanently fails bundle validation for that session. */
  chat_id?: string
  execution_mode: ExecutionMode
  automation_mode: AutomationMode
  chat_transport_mode?: ChatTransportMode
  knowledge_sharing_enabled?: boolean
  knowledge_last_seen_revision?: number
  last_main_request_summary?: string
  self_evolution?: boolean
	wharnex_instance_id?: string
  self_evolution_activation?: 'restart_pending' | 'restart_scheduled'
  state: string
  created_at: string
  context: { id: string; manifest: ContextManifest }
  plan?: ExecutionPlan
  policy?: PolicyDecision
  last_execution?: ExecutionResult
  pending_host_changes?: PendingHostChange[]
  last_applied_changes?: PendingHostChange[]
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
  /** Wharness's own closed-set classification of the last terminal failure
   *  (e.g. 'offline_go_module_cache'). Recovery affordances MUST key on this
   *  field, never on last_repair_error/last_turn text — that prose is free
   *  form and can be rephrased or come from an external planner. */
  failure_kind?: string
  workflow_round?: number
  last_request_mode?: ChatRequestMode
  planner_in_flight?: boolean
  request_baselines?: Record<string, string>
  baseline_notices?: BaselineNotice[]
  integration_conflict?: IntegrationConflict
  artifacts?: ArtifactRecord[]
  interrupted_execution?: { plan_id: string; requested_at: string; approved: boolean; status?: 'awaiting_decision' | 'running' | 'resuming' | 'failed_retryable'; last_error?: string }
  remote_recovery_attempt?: number
	request_lineages?: Record<string, { request_id: string; root_request_id: string; parent_request_id?: string; kind: 'standard' | 'repair' | 'evidence' | 'conflict' | 'knowledge_review'; created_at: string }>
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


export type ArtifactRecord = {
  id: string
  request_id?: string
  direction: 'input' | 'output'
  kind: string
  name: string
  content_type?: string
  size: number
  sha256: string
  created_at: string
  expires_at: string
  bundle: boolean
  entry_count?: number
}

export type ArtifactEntry = { path: string; size: number; dir: boolean }
export type ArtifactPresentationItem = { path: string; preview_path?: string; label?: string; description?: string; alt?: string; size: number; content_type: string; kind: 'image' | 'audio' | 'video' | 'pdf' | 'html' | 'office' | 'markdown' | 'text' | 'binary' }
export type ArtifactPresentationGallery = { id: string; title?: string; description?: string; layout: 'auto' | 'grid' | 'masonry' | 'strip'; sizing: 'uniform' | 'adaptive'; items: ArtifactPresentationItem[] }
export type ArtifactPresentation = { protocol: 'harness.artifact-presentation/v1'; fallback: boolean; warning?: string; galleries: ArtifactPresentationGallery[] }
export type ArtifactSettings = { retention_days: number; bundle_window_limit: number }
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

export type EvolutionEvidence = {
  events: HarnessEvent[]
  counts: Record<string, number>
  projects: string[]
  categories: string[]
  total: number
  truncated: boolean
}

export type AppConfig = {
  planner: 'manual' | 'openai' | string
  sandbox: 'docker' | 'local' | string
  model: string
  api_configured: boolean
  chatgpt_web_embed: boolean
  remote_input?: {
    enabled: boolean
    provider?: string
    mode: 'local_attachments' | 'remote_url' | 'tunnel'
    instances?: Array<{
      id: string
      provider: string
      priority: number
      available: boolean
      public_url?: string
      error?: string
      limits: { max_requests: number; window_seconds: number; max_files_per_input: number; max_file_bytes: number; max_input_bytes: number; max_stored_objects: number; max_storage_bytes: number }
      usage: { requests_in_window: number; stored_objects: number; storage_bytes: number }
    }>
  }
}

export type RemoteStorageLimits = {
  max_requests: number
  window_seconds: number
  max_files_per_input: number
  max_file_bytes: number
  max_input_bytes: number
  max_stored_objects: number
  max_storage_bytes: number
}

export type RemoteStorageInstance = {
  id: string
  provider: RemoteStorageProviderID
  priority: number
  limits: RemoteStorageLimits
  upload_url?: string
  public_url?: string
  authorization_env?: string
  rclone_remote?: string
  rclone_prefix?: string
}

export type RemoteStorageProviderID = 'http' | 'rclone' | 'drive' | 'dropbox' | 'onedrive' | 's3' | 'webdav' | 'nextcloud' | 'box' | 'pcloud' | 'trycloudflare'
export type RemoteStorageProviderField = { id: string; label: string; placeholder?: string; secret?: boolean; required?: boolean; advanced?: boolean }
export type RemoteStorageProvider = { id: RemoteStorageProviderID; name: string; description: string; auth_mode: 'oauth_browser' | 'credentials' | 'local_tunnel'; available: boolean; fields: RemoteStorageProviderField[] }
export type RemoteStorageConnection = { provider: RemoteStorageProviderID; remote: string; connected: boolean; display_name?: string }

export type RemoteStorageDocument = { version: 1; instances: RemoteStorageInstance[] }
export type RemoteStorageConfigResponse = { config: RemoteStorageDocument; restart_required: boolean; credential_cleanup_warning?: boolean }

export type TunnelProviderID = 'cloudflare_named' | 'ngrok' | 'trycloudflare' | 'zrok' | 'tailscale_funnel' | 'localxpose' | 'localhost_run' | 'pinggy' | 'serveo'
export type TunnelProvider = { id: TunnelProviderID; name: string; description: string; auth_mode: 'token' | 'none' | 'local'; auth_url?: string; permanent_dns: boolean; available: boolean; fields: RemoteStorageProviderField[] }
export type TunnelProviderInstance = { id: string; provider: TunnelProviderID; priority: number; public_url?: string; credential_ref?: string; local_port?: number }
export type TunnelProviderDocument = { version: 1; instance_name?: string; instances: TunnelProviderInstance[] }
export type TunnelProviderConfigResponse = { config: TunnelProviderDocument; restart_required: boolean }
export type TunnelTestResult = { ok: boolean; instance_id: string; public_url: string; latency_ms: number }
export type TunnelProviderEnrollment = { provider: TunnelProviderID; credential_ref: string; public_url: string; local_port?: number }

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

export type WorkspaceMode = 'editor' | 'agent' | 'orchestrator'

export type OrchestratorPlanStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED'
export type OrchestratorTaskStatus = 'PENDING' | 'READY' | 'DOING' | 'REVIEW' | 'COMPLETE' | 'ARCHIVED'
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
  created_at: string; updated_at: string
}

export type OrchestratorTaskRun = {
  id: string; task_id: string; project_path: string; session_id?: string; request_id?: string; execution_plan_id?: string
  attempt: number; status: string; error?: string; started_at: string; completed_at?: string
}

export type OrchestratorOverview = { plans: OrchestratorPlan[]; tasks: OrchestratorTask[]; mutation_slots: number; mutation_slots_used: number }

export type OrchestratorProposalTask = {
  id: string; title: string; description: string; acceptance_criteria: string[]; depends_on: string[]; priority: OrchestratorPriority
  capability: string; complexity: 'low' | 'medium' | 'high'; parallelizable: boolean; impact_files: string[]; read_files: string[]; barrier_files: string[]
}

export type OrchestratorProposal = { protocol: 'harness.orchestrator-plan/v1'; title: string; objective: string; assumptions: string[]; tasks: OrchestratorProposalTask[] }
export type OrchestratorProposalResult = { request_id: string; plan?: OrchestratorPlan; tasks?: OrchestratorTask[]; manual_prompt?: string }
export type OrchestratorRunResult = { task: OrchestratorTask; run: OrchestratorTaskRun; manual_prompt?: string }

export type ChatArtifactKind = 'context' | 'prompt' | 'result' | 'error'
export type ChatArtifactSelection = Record<ChatArtifactKind, boolean>
export type ChatRequestMode = 'direct' | 'plan_first'
export type QueuedChatRequest = {
  id: string
  message: string
  attachments: File[]
  projectFiles: string[]
  artifacts: ChatArtifactSelection
  requestMode: ChatRequestMode
  createdAt: string
}
export type ChatItemSource = 'user' | 'chatgpt' | 'wharness'
export type ChatItemPresentation = 'message' | 'notice' | 'thought' | 'plan' | 'change'
export type ChatPlanApproval = { status: 'pending' | 'approved' | 'rejected'; originalMessage: string; requestId: string }
export type ChatChangeFile = { path: string; additions: number; deletions: number; diff: string }
export type ChatChangeSummary = { planId: string; files: ChatChangeFile[]; hostCommands?: CommandResult[]; appliedAt: string; reverted?: boolean; canRevert: boolean }
export type ChatGPTActivity = { cacheKey?: string; state: 'idle' | 'thinking'; text: string; capturedAt: string }
export type ChatIterationRef = {
  id: string
  requestId: string
  phase: 'outbound' | 'prepared' | 'submitted' | 'workflow' | 'repair' | 'conflict' | 'result' | 'failed'
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

export type BundleSubmission = { session: Session; auto_executed: boolean; auto_applied: boolean; auto_error?: string; execution?: ExecutionResult; policy_blocked?: boolean; policy_reasons?: string[]; repair_prepared?: boolean; remote_recovery_prepared?: boolean; conflict_prepared?: boolean; workflow_executed?: boolean; workflow_prepared?: boolean; workflow_round?: number; restart_scheduled?: boolean; restart_required?: boolean }

export type ProjectStorageUsage = { project_path: string; session_count: number; context_bytes: number; sandbox_bytes: number; artifact_bytes: number; total_bytes: number }
export type BackendStorageUsage = { total_bytes: number; state_bytes: number; context_bytes: number; sandbox_bytes: number; artifact_bytes: number; orphan_bytes: number; projects: ProjectStorageUsage[] }

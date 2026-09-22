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
export type IntegrationConflict = { id: string; request_id: string; original_plan_ids: string[]; paths: string[]; details: Array<{ change_set_id: string; path: string; reason: string }>; created_at: string }
export type ConflictWorkbenchFile = { path: string; base_exists: boolean; current_exists: boolean; incoming_exists: boolean; base: string; current: string; incoming: string }
export type ConflictWorkbench = { id: string; request_id: string; files: ConflictWorkbenchFile[]; manual_paths?: string[] }
export type ConflictManualResolution = { path: string; content: string; exists: boolean }
export type ConflictManualResult = { session: Session; applied: boolean }

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
  created_at?: string
  modified_at?: string
  configurable?: boolean
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
  created_at?: string
  modified_at?: string
  configurable?: boolean
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

/**
 * One `@attach` marker previewed exactly as a request would resolve it.
 *
 * Deliberately the same shape as ContextInspection: an attachment answers the
 * same question about a different root, so the panel that configures it is the
 * one the operator already knows from project settings.
 */
export type AttachmentInspection = {
  root: string
  kind: 'file' | 'directory' | string
  auto_exclude: boolean
  include: string[]
  include_overrides: string[]
  exclude: string[]
  included_files: number
  included_bytes: number
  excluded_items: number
  truncated: boolean
  max_file_bytes: number
  max_total_bytes: number
  max_files: number
  entries: ContextInventoryEntry[]
}

/**
 * A project Wharnex has worked on before, nameable from `@ref` whether or not
 * it is open right now. `open` is a live session holding it — the thing a
 * *change* additionally requires, on top of being merely nameable.
 */
export type KnownProjectRef = {
  name: string
  project_path: string
  open: boolean
}

export type ExecutionMode = 'protected' | 'unprotected'
export type AutomationMode = 'manual' | 'auto' | 'auto_approve'
export type EffortLevel = 'low' | 'medium' | 'high' | 'extra_high' | 'max' | 'ultra' | 'loop'
export type ReasoningEffort = 'instant' | 'medium' | 'high'
/** Scraper: Desktop drives the embedded ChatGPT DOM directly, as it always
 *  has. Manual: Desktop never touches that DOM — the prompt is only shown
 *  for copy/paste and a response bundle is only imported by explicit human
 *  upload. Independent of AutomationMode; Auto + Manual is valid. */
export type ChatTransportMode = 'scraper' | 'manual'
export type TerminalTarget = 'sandbox' | 'host'
export type TerminalSessionDescriptor = { terminal_id: string; target: TerminalTarget }
export type TerminalFrame = { type: 'ready' | 'output' | 'exit' | 'error'; data?: string; code?: number; message?: string }
export type TerminalRunInput = { command: string; cwd: string; label?: string }
export type TerminalRunRequest = TerminalRunInput & { id: number; target?: TerminalTarget; openNew?: boolean }


export type DockerContainerCondition = 'running' | 'restarting' | 'paused' | 'created' | 'error' | 'stopped'
export type DockerContainer = {
  id: string
  name: string
  image: string
  state: string
  condition?: DockerContainerCondition | string
  status: string
  ports?: string
  networks?: string
  compose_project?: string
  compose_service?: string
  exit_code?: number
  error?: string
  protected?: boolean
}

export type DockerComposeService = { name: string; container_count: number; running_count: number; error_count: number }
export type DockerComposeProject = {
  name: string
  container_count: number
  running_count: number
  error_count: number
  stopped_count: number
  protected?: boolean
  redeploy_available?: boolean
  redeploy_reason?: string
  config_files?: string[]
  services?: DockerComposeService[]
}
export type DockerImage = { id: string; repository: string; tag: string; size: string; created_since?: string; in_use?: boolean; container_count?: number }
export type DockerVolume = { name: string; driver: string; mountpoint?: string; scope?: string; in_use?: boolean; container_count?: number }
export type DockerNetwork = { id: string; name: string; driver: string; scope?: string; internal?: boolean; in_use?: boolean; container_count?: number }
export type DockerOverview = {
  compose_projects: DockerComposeProject[]
  containers: DockerContainer[]
  images: DockerImage[]
  volumes: DockerVolume[]
  networks: DockerNetwork[]
  refreshed_at: string
}
export type DockerLogs = { container_id: string; tail: number; content: string }
export type DockerContainerAction = 'start' | 'stop' | 'restart'
export type DockerResourceKind = 'volume' | 'network'

export type TurnKind = 'answer' | 'clarification' | 'investigation' | 'plan' | 'workflow' | 'change' | 'blocked'

export type InterviewOption = { id: string; label: string }
export type InterviewQuestion = { id: string; prompt: string; allow_multiple?: boolean; options: InterviewOption[] }
export type Interview = { protocol: 'harness.interview/v1'; questions: InterviewQuestion[] }

export type AgentTurn = {
  protocol: 'harness.turn/v1'
  request_id: string
  kind: TurnKind
  chat_title?: string
  message: string
  outcome?: { status: 'completed' | 'failed' | 'partial'; reason_code?: string; message?: string; retryable: boolean }
	interview?: Interview
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

export type ActivationImpact = 'backend' | 'frontend' | 'desktop' | 'tunnel'


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
  bundle_type?: string
  entry_count?: number
}

export type ArtifactEntry = { path: string; size: number; dir: boolean }
export type ChatFileRecord = {
  artifact_id: string
  request_id?: string
  direction: 'input' | 'output'
  source: 'attachment' | 'returned' | 'system' | string
  name: string
  path?: string
  content_type?: string
  size: number
  created_at: string
  direct: boolean
}

export type ManagedArtifact = {
  session_id: string
  project_path: string
  chat_id?: string
  artifact: ArtifactRecord
}

export type PostgresConnectionInput = { host: string; port: number; database: string; user: string; password: string; sslmode: 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full' }
export type PostgresColumn = { name: string; data_type: string; nullable: boolean }
export type PostgresTable = { schema: string; name: string; type: string; columns: PostgresColumn[] }
export type PostgresCatalog = { database: string; version: string; tables: PostgresTable[] }
export type PostgresQueryResult = { columns: string[]; rows: unknown[][]; row_count: number; truncated: boolean; duration_ms: number }

export type ArtifactPresentationItem = { path: string; preview_path?: string; label?: string; description?: string; alt?: string; size: number; content_type: string; kind: 'image' | 'audio' | 'video' | 'pdf' | 'html' | 'office' | 'markdown' | 'text' | 'binary' }
export type ArtifactPresentationGallery = { id: string; title?: string; description?: string; layout: 'auto' | 'grid' | 'masonry' | 'strip'; sizing: 'uniform' | 'adaptive'; items: ArtifactPresentationItem[] }
export type ArtifactPresentation = { protocol: 'harness.artifact-presentation/v1'; fallback: boolean; warning?: string; galleries: ArtifactPresentationGallery[] }
export type ArtifactSettings = { retention_days: number; bundle_window_limit: number; attachment_count_limit: number; request_bundle_total_bytes: number; request_bundle_part_bytes: number; request_bundle_part_limit: number }
export type LanguageCode = 'pt' | 'en' | 'fr'
export type LanguageSettings = { version: 1; interface_language: LanguageCode; translation_languages: LanguageCode[] }
export type MarkdownTranslation = { protocol: 'harness.utility/v1'; task: 'translate_markdown'; target_language: LanguageCode; markdown: string }
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
  project_id: string
  chat_id: string
  session_id: string
  request_id: string
  root_request_id: string
  conversation_id: string
  parent_task_id: string
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
  version?: string
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

export type WorkspaceSearchOptions = {
  query: string
  case_sensitive: boolean
  regex: boolean
  whole_word: boolean
  fuzzy: boolean
  limit?: number
}

export type WorkspaceSearchMatch = {
  path: string
  line: number
  column: number
  preview: string
}

export type WorkspaceSearchResult = {
  matches: WorkspaceSearchMatch[]
  truncated: boolean
}


export type ProjectConfig = {
  version: number
  project: { name: string }
  context: {
    auto_exclude: boolean
    max_file_bytes: number
    include: string[]
    include_overrides?: string[]
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

export type OrchestratorPlanningRequest = {
  request_id: string; task_id: string; objective?: string; status: string; attempt: number; max_attempts: number; last_error?: string; created_at: string; updated_at: string
}

export type OrchestratorOverview = { plans: OrchestratorPlan[]; tasks: OrchestratorTask[]; planning_requests: OrchestratorPlanningRequest[]; mutation_slots: number; mutation_slots_used: number }

export type OrchestratorProposalTask = {
  id: string; title: string; description: string; acceptance_criteria: string[]; depends_on: string[]; priority: OrchestratorPriority
  capability: string; complexity: 'low' | 'medium' | 'high'; parallelizable: boolean; impact_files: string[]; read_files: string[]; barrier_files: string[]
}

export type OrchestratorProposal = { protocol: 'harness.orchestrator-plan/v1'; title: string; objective: string; assumptions: string[]; tasks: OrchestratorProposalTask[] }
export type OrchestratorProposalResult = { request_id: string; plan?: OrchestratorPlan; tasks?: OrchestratorTask[]; manual_prompt?: string; worker_task_id?: string; delivery_status?: string }
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
export type ChatPlanApproval = { status: 'pending' | 'approved' | 'rejected' | 'superseded'; originalMessage?: string; requestId: string }
export type ChatChangeFile = { path: string; additions: number; deletions: number; diff: string }
// `summary` is the planner's own short description of what the bundle did. The
// protocol requires it on every plan-bearing response, and the self-evolution
// activation dialog shows it as the explanation of what a restart activates.
export type ChatChangeSummary = { planId: string; requestId?: string; summary?: string; files: ChatChangeFile[]; hostCommands?: CommandResult[]; appliedAt: string; reverted?: boolean; canRevert: boolean }
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
  self_evolution_activation?: Session['self_evolution_activation']
  integration_conflict?: { id: string; path_count: number }
  interrupted_execution?: { plan_id: string; status: string }
}

export type ChatGPTActivity = { cacheKey?: string; requestId?: string; state: 'idle' | 'thinking'; text: string; capturedAt: string }
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

export type ChatItem = { id: string; role: 'user' | 'harness'; text: string; createdAt?: string; meta?: string; turnKind?: TurnKind; attachments?: ChatAttachmentInfo[]; iteration?: ChatIterationRef; source?: ChatItemSource; presentation?: ChatItemPresentation; approval?: ChatPlanApproval; change?: ChatChangeSummary; interview?: Interview }

export type BundleSubmission = { session: Session; auto_executed: boolean; auto_applied: boolean; auto_error?: string; execution?: ExecutionResult; policy_blocked?: boolean; policy_reasons?: string[]; repair_prepared?: boolean; remote_recovery_prepared?: boolean; conflict_prepared?: boolean; workflow_executed?: boolean; workflow_prepared?: boolean; workflow_round?: number; restart_scheduled?: boolean; restart_required?: boolean }

export type ProjectStorageUsage = { project_path: string; session_count: number; context_bytes: number; sandbox_bytes: number; artifact_bytes: number; archive_bytes: number; total_bytes: number }
export type BackendStorageUsage = { total_bytes: number; state_bytes: number; context_bytes: number; sandbox_bytes: number; artifact_bytes: number; archive_bytes: number; orphan_bytes: number; projects: ProjectStorageUsage[] }


export type ProjectTodoKind = 'feature' | 'improvement' | 'error'
export type ProjectTodoUrgency = 'very_urgent' | 'urgent' | 'normal' | 'no_urgency'
export type ProjectTodoAttachment = { name: string; size: number; mime: string; storage_ref: string; preview_kind?: 'thumbnail' | 'icon' | 'none' }
export type ProjectTodo = {
  id: string
  project_path: string
  body: string
  status: 'open' | 'done'
  kind?: ProjectTodoKind
  urgency?: ProjectTodoUrgency
  description?: string
  pre_plan?: string[]
  classification_status: 'queued' | 'classified' | 'failed'
  classification_task_id?: string
  classification_error?: string
  attachment_cache_key?: string
  attachments?: ProjectTodoAttachment[]
  project_files?: string[]
  execution_status?: 'open' | 'processing' | 'done' | 'failed'
  execution_request_id?: string
  execution_session_id?: string
  execution_chat_id?: string
  execution_target?: 'chat' | 'orchestrator' | string
  execution_plan_id?: string
  execution_error?: string
  archived_at?: string
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Git surface
// ---------------------------------------------------------------------------

/**
 * How a project treats its own history once a verified change is applied.
 * `auto` commits the integration immediately; `manual` returns the branch to
 * where the operator left it and keeps the change as uncommitted work, with
 * the planner-authored commit message preserved as a pending record.
 */
export type GitCommitMode = 'auto' | 'manual'
export type GitConflictStrategy = 'gpt_only' | 'user_only' | 'user_decide'
export type GitCommitAuthorStrategy = 'wharnex' | 'git_user' | 'custom' | 'wharnex_git_user' | 'wharnex_custom'
export type GitAuthorSettings = { commit_author_strategy: GitCommitAuthorStrategy; custom_author_name?: string; custom_author_email?: string }

export type GitBranch = {
  name: string
  remote?: string
  current: boolean
  commit_sha: string
  subject?: string
  upstream?: string
  ahead: number
  behind: number
  has_upstream: boolean
  gone: boolean
  counterpart?: string
  has_counterpart?: boolean
  unmerged_commits?: number
}

export type GitRemote = { name: string; url: string }
export type GitTag = { name: string; commit_sha: string; created_at?: string }

export type GitCommit = {
  sha: string
  short_sha: string
  subject: string
  body?: string
  author_name: string
  author_email: string
  committed_at: string
  /** Parent SHAs in Git order; merge commits carry 2+ entries. */
  parents: string[]
  request_id?: string
  plan_id?: string
  /** Originated from a Wharnex change, identified by its Request-Id trailer. */
  wharnex: boolean
  merge: boolean
  /** Reachable from the valid upstream, or from any remote-tracking ref when no upstream exists. */
  pushed: boolean
  files_changed?: number
  additions?: number
  deletions?: number
}

export type GitPendingCommit = {
  id: string
  project_path: string
  session_id?: string
  request_id?: string
  plan_id?: string
  subject: string
  message: string
  paths: string[]
  /** Only populated by the per-record endpoint; the overview omits it. */
  diff?: string
  diff_truncated?: boolean
  created_at: string
}

export type GitWorkingStatus = 'modified' | 'added' | 'deleted' | 'unmerged'

export type GitWorkingFile = {
  path: string
  kind: 'change' | 'gitlink' | 'submodule' | 'embedded_repository' | 'unmerged'
  status: GitWorkingStatus
  additions?: number
  deletions?: number
}

export type GitWorkingSummary = {
  clean: boolean
  stageable_count: number
  files: GitWorkingFile[]
  dirty_submodules?: string[]
  embedded_repositories?: string[]
  unmerged_paths?: string[]
}

export type GitConflictContext = {
  origin: 'integration' | 'push' | 'branch_merge' | 'pull' | 'remote_branch_merge'
  ref: string
  remote?: string
  remote_branch?: string
  base_sha: string
  ours_sha: string
  theirs_sha: string
  target_branch?: string
  source_refs?: string[]
}

export type GitFileDiff = { path: string; diff: string; truncated?: boolean }

export type GitUnpushedOverview = {
  branch: string
  upstream?: string
  remote?: string
  remote_branch?: string
  has_upstream: boolean
  commits: GitCommit[]
}

export type GitCommitDetail = {
  commit: GitCommit
  diff: string
  diff_truncated?: boolean
}

export type GitHistoryPage = { commits: GitCommit[]; next_offset: number; has_more: boolean }

export type GitContributionWeek = { started_at: string; commits: number; additions: number; deletions: number }
export type GitContributionDay = { started_at: string; commits: number; additions: number; deletions: number }
export type GitContributor = {
  name: string
  email: string
  commits: number
  additions: number
  deletions: number
  first_commit_at: string
  last_commit_at: string
  weekly_commits: number[]
}
export type GitContributorsOverview = {
  contributors: GitContributor[]
  weeks: GitContributionWeek[]
  days: GitContributionDay[]
  total_commits: number
  truncated: boolean
}

export type GitHeadState = {
  current_branch?: string
  detached: boolean
  commit_sha?: string
}

export type GitRepository = {
  path: string
  label: string
  depth: number
  root: boolean
  initialized: boolean
  available: boolean
  unavailable?: string
  current_branch?: string
  detached: boolean
  commit_sha?: string
}

export type GitOverview = {
  project_path: string
  project_version?: string
  repository: string
  repositories: GitRepository[]
  available: boolean
  unavailable?: string
  commit_mode: GitCommitMode
  conflict_strategy?: GitConflictStrategy
  author_settings?: GitAuthorSettings
  /** Self-evolution always commits, so the toggle is presented as fixed. */
  commit_mode_fixed?: boolean
  current_branch?: string
  detached: boolean
  in_progress?: string
  has_identity: boolean
  branches: GitBranch[]
  remotes: GitRemote[]
  tags: GitTag[]
  commits: GitCommit[]
  pending: GitPendingCommit[]
  working: GitWorkingSummary
  conflict?: GitConflictContext
}

export type GitCommitOutcome = { pending_id: string; subject: string; commit_sha?: string; skipped?: string }
export type GitCommitResult = { outcomes: GitCommitOutcome[]; blocked?: string[] }
export type GitWorktreeCommitResult = { commit_sha: string; paths: string[] }
export type GitPushResult = {
  outcome: 'pushed' | 'up_to_date' | 'rejected' | 'auth_required' | 'failed' | 'conflict'
  remote: string
  branch: string
  detail?: string
  integrated?: boolean
  conflict_id?: string
}
export type GitMergeResult = { outcome: string; ref: string; commit_sha?: string; paths?: string[]; conflict_id?: string; detail?: string }
export type GitRemoteMergeResult = { outcome: string; target_ref: string; source_refs: string[]; commit_sha?: string; push_outcome?: string; conflict_ref?: string; conflict_id?: string; paths?: string[]; detail?: string }
export type GitBranchActionResult = { outcome: string; remote?: string; branch?: string; ref?: string; commit_sha?: string; paths?: string[]; conflict_id?: string; detail?: string }
export type GitBranchMutationResult = { outcome: 'created' | 'deleted'; branch: string }
export type GitReleaseNotesResult = { body: string; commit_count: number }
export type GitReleaseResult = { outcome: 'published'; remote: string; branch: string; tag: string; commit_sha: string; release_url: string }

// One conversation a chat with a lost binding may belong to, with the evidence
// that ties it to that chat so the operator can judge it instead of guessing.
export type WorkspaceChatBindingCandidate = {
  chatgpt_url: string
  conversation_id: string
  evidence: 'agent_queue' | 'transcript' | 'session_events'
  bound_to_chat_id?: string
  conflict: boolean
}
export type WorkspaceChatBindingRecovery = {
  chat_id: string
  bound: boolean
  chatgpt_url?: string
  candidates: WorkspaceChatBindingCandidate[]
}

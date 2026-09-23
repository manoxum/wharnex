export type PairingStatus = { paired: boolean; remote: boolean }
export type TunnelState = 'active' | 'paused' | 'stopped' | 'unavailable'
export type TunnelInstance = {
  id: string; provider: string; priority: number; available: boolean; state?: TunnelState; public_url?: string; error?: string
  usage: { requests_in_window: number; stored_objects: number; storage_bytes: number }
}
export type RemoteInputConfig = { enabled: boolean; provider?: string; mode: string; instances?: TunnelInstance[] }
export type AppConfig = { version?: string; planner?: string; remote_input?: RemoteInputConfig }
export type TunnelTestResult = { ok: boolean; instance_id: string; public_url: string; latency_ms: number }

export type ProjectStorage = { project_path: string; session_count: number; total_bytes: number }
export type StorageUsage = { projects: ProjectStorage[]; total_bytes: number }
export type Session = {
  id: string; chat_id?: string; project_path: string; state: string; automation_mode: 'manual' | 'auto' | 'auto_approve'
  effort_level: string; reasoning_effort: 'instant' | 'medium' | 'high'; last_request_id?: string; last_manual_prompt?: string
  last_turn?: { kind?: string; message?: string; outcome?: { status?: string } }; last_execution?: { status?: string }
}
export type WorkspaceChat = {
  id: string; project_path: string; session_id: string; title: string; chatgpt_url?: string
  saved_at?: string; archived_at?: string; created_at: string; updated_at: string
}
export type ChatItem = {
  id: string; role: 'user' | 'harness'; text: string; createdAt?: string; meta?: string; source?: string; presentation?: string
  attachments?: Array<{ name: string; size: number; mime?: string }>
}
export type ChatItemWire = { id: string; chat_id: string; created_at: string; payload: ChatItem }
export type RequestMode = 'direct' | 'plan_first'
export type RemoteAttachment = { name: string; mime: string; contentBase64: string }
export type RemoteDispatchInput = {
  request_id: string; workspace_chat_id: string; bootstrap_text: string; chat_title: string; conversation_url?: string
  attachments: RemoteAttachment[]; project_files: string[]; tunnel_instance_ids: string[]; include_context: boolean
}
export type AttentionRecord = { session_id: string; chat_id: string; state: string; failure_kind?: string; last_request_id?: string; planner_in_flight?: boolean; has_manual_prompt?: boolean }
export type QueueTask = { task_id: string; type: string; status: string; title?: string; description?: string; request_id?: string; chat_id?: string; last_error?: string; updated_at?: string }
export type ProjectTodo = { id: string; body: string; status: 'open' | 'done'; kind?: string; urgency?: string; classification_status?: string; execution_status?: string; archived_at?: string }
export type FileEntry = { path: string; name?: string; is_dir?: boolean; size?: number }
export type Artifact = { id?: string; artifact_id?: string; filename?: string; name?: string; kind?: string; request_id?: string; created_at?: string }
export type OrchestratorPlan = { id: string; title: string; objective: string; status: string }
export type OrchestratorTask = { id: string; plan_id?: string; title: string; description?: string; status: string; condition?: string; priority?: string }
export type OrchestratorOverview = { plans: OrchestratorPlan[]; tasks: OrchestratorTask[]; planning_requests: Array<Record<string, unknown>>; mutation_slots: number; mutation_slots_used: number }
export type OrchestratorProposalResult = { request_id: string; worker_task_id?: string; delivery_status?: string; manual_prompt?: string }
export type OrchestratorRunResult = { task: OrchestratorTask; run: { session_id?: string; request_id?: string; status: string }; manual_prompt?: string }
export type PanelName = 'notifications' | 'archive' | 'todos' | 'project' | 'library' | 'knowledge' | 'git' | 'agents' | 'tasks' | 'errors' | 'evolution' | 'database' | 'docker' | 'files' | 'artifacts' | 'tunnels'

export type ProjectConfig = {
  version: number
  project: { name: string }
  context: { auto_exclude: boolean; max_file_bytes: number; include: string[]; include_overrides?: string[]; exclude: string[] }
}
export type KnowledgeEntry = { id: string; content: string; version: number; updated_at: string; updated_by_request_id?: string }
export type KnowledgeCatalog = { project_path: string; revision: number; entries: KnowledgeEntry[]; updated_at: string; updated_by_request_id?: string }
export type AgentProviderState = { provider: string; paused: boolean; paused_until?: string; reason?: string; rate_limit_level?: number; average_processing_ms?: number; valid_sample_count?: number; updated_at?: string }
export type AgentQueueSummary = { queued: number; due: number; scheduled: number; guarded: number; blocked: number; due_supervisor_lanes: number; due_worker: number; due_translator?: number; other_projects?: number; counts: Record<string, number>; oldest_due_created_at?: string; next_not_before?: string }
export type ExecutionError = { id: string; session_id: string; request_id?: string; root_request_id?: string; plan_id?: string; stage?: string; error: string; cause?: string; failure_kind?: string; status_code?: number; status: 'open' | 'resolved'; occurred_at: string; resolved_at?: string; logs?: Array<Record<string, unknown>> }
export type EvolutionEvidence = { events: Array<{ id: string; type: string; timestamp: string; data: Record<string, unknown>; project_path?: string; project_name?: string; category?: string }>; counts: Record<string, number>; projects: string[]; categories: string[]; total: number; truncated: boolean }
export type PostgresConnection = { host: string; port: number; database: string; user: string; password: string; sslmode: 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full' }
export type PostgresCatalog = { database: string; version: string; tables: Array<{ schema: string; name: string; type: string; columns: Array<{ name: string; data_type: string; nullable: boolean }> }> }
export type PostgresQueryResult = { columns: string[]; rows: unknown[][]; row_count: number; truncated: boolean; duration_ms: number }

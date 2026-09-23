import type { AgentTurn, AppConfig, AttachmentInspection, AttentionRecord, KnownProjectRef, ArtifactEntry, ArtifactPresentation, ArtifactRecord, ArtifactSettings, ManagedArtifact, ChatFileRecord, PostgresCatalog, PostgresConnectionInput, PostgresQueryResult, LanguageCode, LanguageSettings, MarkdownTranslation, AutomationMode, EffortLevel, ChatTransportMode, ChatRequestMode, ChatItem, ChatAgentQueueSummary, ChatAgentTask, ChatAgentTaskEvent, HarnessEvent, BackendStorageUsage, BundleQuota, BundleSubmission, CommandResult, CommandSpec, ContextInspection, EvolutionEvidence, ExecutionConcurrency, ExecutionMode, ExecutionPlan, ExecutionResult, ExecutionErrorRecord, DockerOverview, DockerLogs, DockerContainerAction, DockerResourceKind, FileEntry, ProjectConfig, ProjectKnowledge, ProjectProvision, ProjectTodo, RemoteStorageConfigResponse, RemoteStorageConnection, RemoteStorageDocument, RemoteStorageProvider, RemoteStorageProviderID, OrchestratorOverview, OrchestratorPlanningRequest, OrchestratorPriority, OrchestratorProposal, OrchestratorProposalResult, OrchestratorRunResult, OrchestratorTask, OrchestratorTaskRun, OrchestratorTaskStatus, Session, TerminalTarget, TerminalSessionDescriptor, TunnelProvider, TunnelProviderConfigResponse, TunnelProviderDocument, TunnelProviderEnrollment, TunnelProviderID, TunnelTestResult, WorkspaceFile, WorkspaceSearchOptions, WorkspaceSearchResult, GitHeadState, GitOverview, GitFileDiff, GitCommitMode, GitPendingCommit, GitCommitResult, GitPushResult, GitMergeResult, GitRemoteMergeResult, GitBranchActionResult, GitBranchMutationResult, GitReleaseNotesResult, GitReleaseResult, GitCommit, GitUnpushedOverview, GitCommitDetail, GitHistoryPage, GitContributorsOverview, GitBranch, GitConflictStrategy, GitAuthorSettings, GitWorktreeCommitResult, ConflictWorkbench, ConflictManualResolution, ConflictManualResult, WorkspaceChatBindingRecovery } from '../types'
import type { DurableWorkspaceChatRecord } from './workspaceMemory'
import type { ReasoningEffort } from '../types'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8888'

export class APIError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message)
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`
    throw new APIError(message, response.status, data)
  }
  return data as T
}

export type ChatExportRequest = {
  chat_id: string
  title: string
  chatgpt_url?: string
  chat_items: ChatItem[]
  frontend_events: HarnessEvent[]
}

export type ComposerBundlePreviewFile = {
  name: string
  mime?: string
  contentBase64: string
}

export type ComposerBundlePreviewInput = {
  message: string
  planningMode: ChatRequestMode
  attachments: ComposerBundlePreviewFile[]
  artifacts: ComposerBundlePreviewFile[]
  projectFiles: string[]
}

async function requestDownload(path: string, body: unknown): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const message = data?.error?.message || `HTTP ${response.status}`
    throw new APIError(message, response.status, data)
  }
  const disposition = response.headers.get('Content-Disposition') || ''
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1]
  const filename = encoded ? decodeURIComponent(encoded) : plain || 'wharness-chat-export.zip'
  return { blob: await response.blob(), filename }
}

// A Go backend marshals an empty slice as null unless it was explicitly
// allocated. The orchestrator views call .filter/.map on these arrays
// directly, so a single null took down the entire workspace render on any
// project with no plans yet. The backend now always emits [], and this keeps
// an older or partially deployed backend from being able to crash the app.
export function normalizeOrchestratorOverview(overview: OrchestratorOverview): OrchestratorOverview {
  return {
    ...overview,
    plans: Array.isArray(overview?.plans) ? overview.plans : [],
    tasks: Array.isArray(overview?.tasks) ? overview.tasks.map((task) => ({ ...task, depends_on: Array.isArray(task?.depends_on) ? task.depends_on : [] })) : [],
    planning_requests: Array.isArray(overview?.planning_requests) ? overview.planning_requests : [],
  }
}

// Same defence as normalizeOrchestratorOverview: a Go backend marshals an
// unallocated slice as null, and this panel maps over every one of these.
export function normalizeGitOverview(overview: GitOverview): GitOverview {
  return {
    ...overview,
    repository: overview?.repository || '',
    repositories: Array.isArray(overview?.repositories) ? overview.repositories : [],
    branches: Array.isArray(overview?.branches) ? overview.branches : [],
    remotes: Array.isArray(overview?.remotes) ? overview.remotes : [],
    tags: Array.isArray(overview?.tags) ? overview.tags : [],
    commits: Array.isArray(overview?.commits) ? overview.commits : [],
    pending: Array.isArray(overview?.pending) ? overview.pending : [],
    working: {
      ...(overview?.working || { clean: true, stageable_count: 0 }),
      files: Array.isArray(overview?.working?.files) ? overview.working.files.map((file) => ({
        ...file,
        status: file.status === 'added' || file.status === 'deleted' || file.status === 'unmerged' ? file.status : 'modified',
      })) : [],
    },
  }
}

function chatAgentQuery(activeOnly: boolean, projectPath: string, limit = 0) {
  const params = new URLSearchParams()
  if (activeOnly) params.set('active', '1')
  if (projectPath) params.set('project_id', projectPath)
  if (limit > 0) params.set('limit', String(limit))
  const query = params.toString()
  return query ? `?${query}` : ''
}

function gitQuery(path: string, repository = '') {
  if (!repository) return path
  return `${path}${path.includes('?') ? '&' : '?'}repository=${encodeURIComponent(repository)}`
}

export const api = {
  url: API_URL,
  config: () => request<AppConfig>('/api/config'),
  executionConcurrency: () => request<ExecutionConcurrency>('/api/execution-concurrency'),
  // projectPath scopes the queue to one project. A project-scoped view MUST
  // always pass it: the queue is shared by every open project, and the panel
  // exists to answer whether *this* project is stuck (see adr/ADR-0044).
  chatAgentTasks: (activeOnly = false, projectPath = '', limit = 0) =>
    request<{ tasks: ChatAgentTask[] }>(`/api/chat-agent/tasks${chatAgentQuery(activeOnly, projectPath, limit)}`),
  projectTasks: (projectPath = '', limit = 500) => {
    const query = new URLSearchParams()
    if (projectPath) query.set('project_id', projectPath)
    if (limit > 0) query.set('limit', String(limit))
    const encoded = query.toString()
    return request<{ tasks: ChatAgentTask[] }>(`/api/tasks${encoded ? `?${encoded}` : ''}`)
  },
  chatAgentTasksForRequest: (requestID: string) => request<{ tasks: ChatAgentTask[] }>(`/api/chat-agent/tasks?request_id=${encodeURIComponent(requestID)}&limit=50`),
  chatAgentTaskSummary: (projectPath = '') =>
    request<ChatAgentQueueSummary>(`/api/chat-agent/tasks/summary${projectPath ? `?project_id=${encodeURIComponent(projectPath)}` : ''}`),
  assignChatAgentTask: (taskID: string, workerID: string, keepFlowing = false) =>
    request<ChatAgentTask>(`/api/chat-agent/tasks/${encodeURIComponent(taskID)}/assign`, { method: 'POST', body: JSON.stringify({ worker_id: workerID, keep_flowing: keepFlowing }) }),
  // Durable per-task decision ledger (adr/ADR-0064): every recovery reload,
  // keep-continue wake-up, bundle validated/rejected and human escalation
  // recorded against this one task, oldest first.
  chatAgentTaskEvents: (taskID: string) =>
    request<{ events: ChatAgentTaskEvent[] }>(`/api/chat-agent/tasks/${encodeURIComponent(taskID)}/events`),
  updateExecutionConcurrency: (concurrency: number) => request<ExecutionConcurrency>('/api/execution-concurrency', { method: 'PUT', body: JSON.stringify({ concurrency }) }),
  tunnelConfig: () => request<TunnelProviderConfigResponse>('/api/tunnel-config'),
  updateTunnelConfig: (config: TunnelProviderDocument) => request<TunnelProviderConfigResponse>('/api/tunnel-config', { method: 'PUT', body: JSON.stringify(config) }),
  tunnelProviders: () => request<{ providers: TunnelProvider[] }>('/api/tunnel/providers'),
  testTunnel: (instanceID: string) => request<TunnelTestResult>('/api/tunnel/test', { method: 'POST', body: JSON.stringify({ instance_id: instanceID }) }),
  connectTunnelProvider: (instanceID: string, provider: TunnelProviderID, fields: Record<string, string>) => request<TunnelProviderEnrollment>('/api/tunnel/connections', { method: 'POST', body: JSON.stringify({ instance_id: instanceID, provider, fields }) }),
  disconnectTunnelProvider: (credentialRef: string) => request<void>(`/api/tunnel/connections/${encodeURIComponent(credentialRef)}`, { method: 'DELETE' }),
  remoteStorageConfig: () => request<RemoteStorageConfigResponse>('/api/remote-storage-config'),
  updateRemoteStorageConfig: (config: RemoteStorageDocument) => request<RemoteStorageConfigResponse>('/api/remote-storage-config', { method: 'PUT', body: JSON.stringify(config) }),
  remoteStorageProviders: () => request<{ providers: RemoteStorageProvider[] }>('/api/remote-storage/providers'),
  connectRemoteStorage: (instanceID: string, provider: RemoteStorageProviderID, fields: Record<string, string>) => request<RemoteStorageConnection>('/api/remote-storage/connections', { method: 'POST', body: JSON.stringify({ instance_id: instanceID, provider, fields }) }),
  checkRemoteStorage: (remote: string) => request<{ connected: boolean }>('/api/remote-storage/connections/check', { method: 'POST', body: JSON.stringify({ remote }) }),
  artifactSettings: () => request<ArtifactSettings>('/api/artifact-settings'),
  managedArtifacts: (query = '', bundlesOnly = true, kind = '') => request<{ artifacts: ManagedArtifact[] }>(`/api/artifacts?q=${encodeURIComponent(query)}${bundlesOnly ? '&bundles=1' : ''}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`),
  deleteManagedArtifact: (sessionId: string, artifactId: string) => request<{ deleted: boolean }>(`/api/artifacts/${encodeURIComponent(sessionId)}/${encodeURIComponent(artifactId)}`, { method: 'DELETE' }),
  testPostgres: (connection: PostgresConnectionInput) => request<{ connected: boolean }>('/api/database/postgres/test', { method: 'POST', body: JSON.stringify({ connection }) }),
  postgresCatalog: (connection: PostgresConnectionInput) => request<PostgresCatalog>('/api/database/postgres/catalog', { method: 'POST', body: JSON.stringify({ connection }) }),
  queryPostgres: (connection: PostgresConnectionInput, sql: string, readOnly: boolean) => request<PostgresQueryResult>('/api/database/postgres/query', { method: 'POST', body: JSON.stringify({ connection, sql, read_only: readOnly }) }),
  languageSettings: () => request<LanguageSettings>('/api/language-settings'),
  updateLanguageSettings: (settings: LanguageSettings) => request<LanguageSettings>('/api/language-settings', { method: 'PUT', body: JSON.stringify(settings) }),
  updateArtifactSettings: (settings: ArtifactSettings) => request<ArtifactSettings>('/api/artifact-settings', { method: 'PUT', body: JSON.stringify(settings) }),
  bundleQuota: () => request<BundleQuota>('/api/bundle-quota'),
  artifacts: (id: string) => request<{ artifacts: ArtifactRecord[] }>(`/api/sessions/${id}/artifacts`),
  chatFiles: (id: string) => request<{ files: ChatFileRecord[] }>(`/api/sessions/${id}/chat-files`),
  saveChatFileToLibrary: (id: string, artifactId: string, path = '') => request<ArtifactRecord>(`/api/sessions/${id}/chat-files/${encodeURIComponent(artifactId)}/library`, { method: 'POST', body: JSON.stringify({ path }) }),
  exportChat: (id: string, input: ChatExportRequest) => requestDownload(`/api/sessions/${id}/chat-export`, input),
  artifactEntries: (id: string, artifactId: string) => request<{ entries: ArtifactEntry[] }>(`/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}/entries`),
  artifactPresentation: (id: string, artifactId: string) => request<ArtifactPresentation>(`/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}/presentation`),
  persistArtifact: (id: string, input: { request_id: string; direction: 'input' | 'output'; kind: string; filename: string; content_type: string; content_base64: string }) => request<ArtifactRecord>(`/api/sessions/${id}/artifacts`, { method: 'POST', body: JSON.stringify(input) }),
  artifactURL: (id: string, artifactId: string, preview = false) => `${API_URL}/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}${preview ? '?preview=1' : ''}`,
  artifactEntryURL: (id: string, artifactId: string, path: string, download = false) => `${API_URL}/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}/entry?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  storage: () => request<BackendStorageUsage>('/api/storage'),
  clearStorage: (confirm: string) => request<{ status: string }>('/api/storage', { method: 'DELETE', body: JSON.stringify({ confirm }) }),
  createProject: (parentPath: string, name: string) => request<ProjectProvision>('/api/projects/create', { method: 'POST', body: JSON.stringify({ parent_path: parentPath, name }) }),
  cloneProject: (repositoryURL: string, parentPath: string, directory = '') => request<ProjectProvision>('/api/projects/clone', { method: 'POST', body: JSON.stringify({ repository_url: repositoryURL, parent_path: parentPath, directory }) }),
  createSession: (projectPath: string, executionMode: ExecutionMode = 'protected', automationMode: AutomationMode = 'auto', chatId?: string, effortLevel: EffortLevel = 'medium', reasoningEffort: ReasoningEffort = 'high') =>
    request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ project_path: projectPath, execution_mode: executionMode, automation_mode: automationMode, effort_level: effortLevel, reasoning_effort: reasoningEffort, chat_id: chatId }) }),
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  setRelatedProjects: (id: string, projectPaths: string[]) =>
    request<Session>(`/api/sessions/${id}/related-projects`, { method: 'PUT', body: JSON.stringify({ project_paths: projectPaths }) }),
  workspaceChats: (projectPath: string) => request<{ chats: DurableWorkspaceChatRecord[] }>(`/api/workspace-chats?project_path=${encodeURIComponent(projectPath)}`),
  saveWorkspaceChat: (chat: DurableWorkspaceChatRecord) => request<DurableWorkspaceChatRecord>(`/api/workspace-chats/${encodeURIComponent(chat.id)}`, { method: 'PUT', body: JSON.stringify(chat) }),
  workspaceChatItems: (chatId: string) => request<{ items: Array<{ id: string; chat_id: string; created_at: string; payload: ChatItem }> }>(`/api/workspace-chats/${encodeURIComponent(chatId)}/items`),
  replaceWorkspaceChatItems: (chatId: string, items: ChatItem[]) => request<{ ok: boolean; count: number }>(`/api/workspace-chats/${encodeURIComponent(chatId)}/items`, {
    method: 'PUT',
    body: JSON.stringify({ items: items.map((item) => ({ id: item.id, chat_id: chatId, created_at: item.createdAt || new Date().toISOString(), payload: item })) }),
  }),
  deleteWorkspaceChat: (chatId: string) => request<{ ok: boolean }>(`/api/workspace-chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }),
  // Proposes the conversations a chat with a lost binding may belong to. It is
  // Read-only: recovery proposes a first binding and can never replace an
  // existing chat affinity.
  // Archiving must reach the durable row, not only localStorage: the durable
  // record wins the merge on restart, so a browser-only archive reopened every
  // archived chat the next time the instance started.
  setWorkspaceChatArchived: (chatId: string, archived: boolean) =>
    request<DurableWorkspaceChatRecord>(`/api/workspace-chats/${encodeURIComponent(chatId)}/archived`, { method: 'PATCH', body: JSON.stringify({ archived }) }),
  setWorkspaceChatSaved: (chatId: string, saved: boolean) =>
    request<DurableWorkspaceChatRecord>(`/api/workspace-chats/${encodeURIComponent(chatId)}/saved`, { method: 'PATCH', body: JSON.stringify({ saved }) }),
  workspaceChatBindingRecovery: (chatId: string) => request<WorkspaceChatBindingRecovery>(`/api/workspace-chats/${encodeURIComponent(chatId)}/binding-recovery`),
  updateWorkspaceChatRemote: (chatId: string, remote: { chatgpt_url?: string; remote_project_ref?: string; remote_title?: string; remote_state?: string }) =>
    request<{ ok: boolean }>(`/api/workspace-chats/${encodeURIComponent(chatId)}/remote`, { method: 'PATCH', body: JSON.stringify(remote) }),
  workspaceAttention: (projectPath: string) => request<{ records: AttentionRecord[] }>(`/api/workspace-attention?project_path=${encodeURIComponent(projectPath)}`),
  projectKnowledge: (id: string) => request<{ knowledge: ProjectKnowledge | null }>(`/api/sessions/${id}/knowledge`),
  projectTodos: (id: string) => request<{ todos: ProjectTodo[] }>(`/api/sessions/${id}/todos`),
  createProjectTodo: (id: string, input: { body: string; attachment_cache_key?: string; attachments?: ProjectTodo['attachments']; project_files?: string[] }) =>
    request<ProjectTodo>(`/api/sessions/${id}/todos`, { method: 'POST', body: JSON.stringify(input) }),
  updateProjectTodo: (id: string, todoId: string, status: ProjectTodo['status']) =>
    request<ProjectTodo>(`/api/sessions/${id}/todos/${encodeURIComponent(todoId)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  classifyProjectTodo: (id: string, todoId: string) =>
    request<ProjectTodo>(`/api/sessions/${id}/todos/${encodeURIComponent(todoId)}/classify`, { method: 'POST', body: '{}' }),
  archiveProjectTodo: (id: string, todoId: string, archived: boolean) =>
    request<ProjectTodo>(`/api/sessions/${id}/todos/${encodeURIComponent(todoId)}/archived`, { method: 'PATCH', body: JSON.stringify({ archived }) }),
  deleteProjectTodo: (id: string, todoId: string) =>
    request<void>(`/api/sessions/${id}/todos/${encodeURIComponent(todoId)}`, { method: 'DELETE' }),
  deleteSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
  setExecutionMode: (id: string, executionMode: ExecutionMode) =>
    request<Session>(`/api/sessions/${id}/execution-mode`, { method: 'PUT', body: JSON.stringify({ execution_mode: executionMode }) }),
  setAutomationMode: (id: string, automationMode: AutomationMode) =>
    request<Session>(`/api/sessions/${id}/automation-mode`, { method: 'PUT', body: JSON.stringify({ automation_mode: automationMode }) }),
  setDebugMode: (id: string, enabled: boolean) =>
    request<Session>(`/api/sessions/${id}/debug-mode`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  setEffortLevel: (id: string, effortLevel: EffortLevel) =>
    request<Session>(`/api/sessions/${id}/effort-level`, { method: 'PUT', body: JSON.stringify({ effort_level: effortLevel }) }),
  setReasoningEffort: (id: string, reasoningEffort: ReasoningEffort) =>
    request<Session>(`/api/sessions/${id}/reasoning-effort`, { method: 'PUT', body: JSON.stringify({ reasoning_effort: reasoningEffort }) }),
  setChatTransportMode: (id: string, chatTransportMode: ChatTransportMode) =>
    request<Session>(`/api/sessions/${id}/chat-transport-mode`, { method: 'PUT', body: JSON.stringify({ chat_transport_mode: chatTransportMode }) }),
  setKnowledgeSharing: (id: string, enabled: boolean) =>
    request<Session>(`/api/sessions/${id}/knowledge-sharing`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  setChatId: (id: string, chatId: string) =>
    request<Session>(`/api/sessions/${id}/chat-id`, { method: 'PUT', body: JSON.stringify({ chat_id: chatId }) }),
  archiveChat: (id: string) => request<Session>(`/api/sessions/${id}/archive`, { method: 'POST', body: '{}' }),
  restoreChat: (id: string) => request<Session>(`/api/sessions/${id}/restore`, { method: 'POST', body: '{}' }),
  message: (id: string, message: string, planningMode: ChatRequestMode = 'direct') =>
    request<{ session: Session; turn?: AgentTurn; plan?: ExecutionPlan; manual_prompt?: string }>(`/api/sessions/${id}/messages`, {
      method: 'POST', body: JSON.stringify({ message, planning_mode: planningMode }),
    }),
  previewComposerBundle: (id: string, input: ComposerBundlePreviewInput) =>
    request<ArtifactRecord>(`/api/sessions/${id}/composer-bundle-preview`, {
      method: 'POST', body: JSON.stringify({
        message: input.message, planning_mode: input.planningMode, project_files: input.projectFiles,
        attachments: input.attachments.map((file) => ({ name: file.name, mime: file.mime, content_base64: file.contentBase64 })),
        artifacts: input.artifacts.map((file) => ({ name: file.name, mime: file.mime, content_base64: file.contentBase64 })),
      }),
    }),
  approvePlan: (id: string, requestId: string) =>
    request<{ session: Session; turn?: AgentTurn; plan?: ExecutionPlan; manual_prompt?: string }>(`/api/sessions/${id}/plans/${encodeURIComponent(requestId)}/approve`, { method: 'POST', body: '{}' }),
  correctPlan: (id: string, requestId: string, guidance: string) =>
    request<{ session: Session; turn?: AgentTurn; plan?: ExecutionPlan; manual_prompt?: string }>(`/api/sessions/${id}/plans/${encodeURIComponent(requestId)}/correct`, { method: 'POST', body: JSON.stringify({ guidance }) }),
  rejectPlan: (id: string, requestId: string) =>
    request<Session>(`/api/sessions/${id}/plans/${encodeURIComponent(requestId)}/reject`, { method: 'POST', body: '{}' }),
  rejectExecutionPlan: (id: string) =>
    request<Session>(`/api/sessions/${id}/execution-plan/reject`, { method: 'POST', body: '{}' }),
  adjustExecutionPlan: (id: string, guidance: string) =>
    request<{ session: Session; turn?: AgentTurn; plan?: ExecutionPlan; manual_prompt?: string }>(`/api/sessions/${id}/execution-plan/adjust`, { method: 'POST', body: JSON.stringify({ guidance }) }),
  controlExecutionPlan: (id: string, action: 'pause' | 'resume' | 'suspend') =>
    request<Session>(`/api/sessions/${id}/execution-plan/control`, { method: 'POST', body: JSON.stringify({ action }) }),
  prepareExecutionPlanReversal: (id: string) =>
    request<{ session: Session; turn?: AgentTurn; plan?: ExecutionPlan; manual_prompt?: string }>(`/api/sessions/${id}/execution-plan/reversal`, { method: 'POST', body: '{}' }),
  manualPlan: (id: string, rawJSON: string) =>
    request<Session>(`/api/sessions/${id}/manual-plan`, { method: 'POST', body: rawJSON }),
  executionBundle: (id: string, filename: string, contentBase64: string) =>
    request<BundleSubmission>(`/api/sessions/${id}/execution-bundle`, { method: 'POST', body: JSON.stringify({ filename, content_base64: contentBase64 }) }),
  retryPolicyRepair: (id: string) => request<Session>(`/api/sessions/${id}/policy-repair`, { method: 'POST', body: '{}' }),
  requestFailureRepair: (id: string, detail = '') => request<Session>(`/api/sessions/${id}/failure-repair`, { method: 'POST', body: JSON.stringify({ detail }) }),
  retryFailedRequest: (id: string, guidance?: string) => request<Session>(`/api/sessions/${id}/failed-request/retry`, { method: 'POST', body: JSON.stringify({ guidance: guidance || '' }) }),
	cancelPendingRequest: (id: string, requestId: string) => request<Session>(`/api/sessions/${id}/request/cancel`, { method: 'POST', body: JSON.stringify({ request_id: requestId }) }),
	cancelInteractive: (id: string) => request<{ cancelled: boolean }>(`/api/sessions/${id}/interactive/cancel`, { method: 'POST' }),
	remoteInputFailure: (id: string, requestId: string, reason: string, kind: 'transport' | 'bundle_validation' | 'submodule_write' = 'transport') => request<Session>(`/api/sessions/${id}/remote-input/failures`, { method: 'POST', body: JSON.stringify({ request_id: requestId, reason, kind }) }),
  execute: (id: string, approved: boolean, sudoPassword = '') =>
    request<{ session: Session; result: ExecutionResult }>(`/api/sessions/${id}/execute`, {
      method: 'POST', body: JSON.stringify({ approved, ...(sudoPassword ? { sudo_password: sudoPassword } : {}) }),
    }),
  approveDebug: (id: string) => request<BundleSubmission>(`/api/sessions/${id}/debug/approve`, { method: 'POST', body: '{}' }),
  retryDependencyNetwork: (id: string) => request<Session>(`/api/sessions/${id}/dependency-network-retry`, { method: 'POST', body: JSON.stringify({ approved: true }) }),
  retryHostDependencyRepair: (id: string) => request<Session>(`/api/sessions/${id}/host-dependency-repair`, { method: 'POST', body: JSON.stringify({ approved: true }) }),
  renewConflictCapsule: (id: string) => request<Session>(`/api/sessions/${id}/conflict-capsule-renew`, { method: 'POST', body: JSON.stringify({ approved: true }) }),
  resumeInterruptedExecution: (id: string, sudoPassword = '') => request<{ session: Session; plan_id: string; status: string }>(`/api/sessions/${id}/interrupted-execution/resume`, { method: 'POST', body: JSON.stringify({ ...(sudoPassword ? { sudo_password: sudoPassword } : {}) }) }),
  discardInterruptedExecution: (id: string) => request<Session>(`/api/sessions/${id}/interrupted-execution/discard`, { method: 'POST', body: '{}' }),
  apply: (id: string) => request<Session>(`/api/sessions/${id}/apply`, { method: 'POST', body: '{}' }),
  rejectPendingChanges: (id: string) => request<Session>(`/api/sessions/${id}/pending-changes/reject`, { method: 'POST', body: '{}' }),
  conflictWorkbench: (id: string) => request<ConflictWorkbench>(`/api/sessions/${id}/conflict`),
  resolveConflictManually: (id: string, resolutions: ConflictManualResolution[]) => request<ConflictManualResult>(`/api/sessions/${id}/conflict/manual`, { method: 'POST', body: JSON.stringify({ resolutions }) }),
  delegateConflictToGPT: (id: string, resolutions: ConflictManualResolution[], guidance = '') => request<Session>(`/api/sessions/${id}/conflict/delegate`, { method: 'POST', body: JSON.stringify({ resolutions, guidance }) }),
  revert: (id: string) => request<Session>(`/api/sessions/${id}/revert`, { method: 'POST', body: '{}' }),
  restoreReverted: (id: string) => request<Session>(`/api/sessions/${id}/restore-reverted`, { method: 'POST', body: '{}' }),
  restartSelfEvolution: (id: string) => request<Session>(`/api/sessions/${id}/self-restart`, { method: 'POST', body: '{}' }),
  evolutionEvidence: (id: string) => request<EvolutionEvidence>(`/api/sessions/${id}/self-evolution/evidence`),
  analyzeEvolutionEvidence: (id: string, evidenceIds: string[]) => request<{ session: Session; evidence_total: number }>(`/api/sessions/${id}/self-evolution/analyze`, { method: 'POST', body: JSON.stringify({ evidence_ids: evidenceIds }) }),
  resolveEvolutionEvidence: (id: string, evidenceIds: string[]) => request<EvolutionEvidence>(`/api/sessions/${id}/self-evolution/evidence/resolve`, { method: 'POST', body: JSON.stringify({ evidence_ids: evidenceIds }) }),
  listFiles: (id: string) => request<{ files: FileEntry[] }>(`/api/sessions/${id}/files`),
  createWorkspacePath: (id: string, path: string, kind: 'file' | 'directory') => request<{ status: string; file?: WorkspaceFile }>(`/api/sessions/${id}/files`, { method: 'POST', body: JSON.stringify({ path, kind }) }),
  renameWorkspacePath: (id: string, from: string, to: string) => request<{ status: string; path: string }>(`/api/sessions/${id}/files`, { method: 'PATCH', body: JSON.stringify({ from, to }) }),
  deleteWorkspacePath: (id: string, path: string) => request<void>(`/api/sessions/${id}/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  readFile: (id: string, path: string) => request<WorkspaceFile>(`/api/sessions/${id}/file?path=${encodeURIComponent(path)}`),
  searchWorkspace: (id: string, options: WorkspaceSearchOptions) => request<WorkspaceSearchResult>(`/api/sessions/${id}/search`, { method: 'POST', body: JSON.stringify(options) }),
  filePreviewURL: (id: string, path: string) => `${API_URL}/api/sessions/${id}/file/preview?path=${encodeURIComponent(path)}`,
  translateMarkdown: (id: string, targetLanguage: LanguageCode, markdown: string) => request<MarkdownTranslation>(`/api/sessions/${id}/translate-markdown`, { method: 'POST', body: JSON.stringify({ target_language: targetLanguage, markdown }) }),
  writeFile: (id: string, file: Pick<WorkspaceFile, 'path' | 'content' | 'sha256'>) =>
    request<WorkspaceFile>(`/api/sessions/${id}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: file.path, content: file.content, expected_sha256: file.sha256 }),
    }),
  terminal: (id: string, command: CommandSpec, target: TerminalTarget = 'sandbox', confirmHost = false) => request<CommandResult>(`/api/sessions/${id}/terminal?target=${encodeURIComponent(target)}${target === 'host' && confirmHost ? '&confirm_host=true' : ''}`, { method: 'POST', body: JSON.stringify(command) }),
  openTerminal: (id: string, input: { cwd: string; network: boolean; cols: number; rows: number }, target: TerminalTarget = 'sandbox', confirmHost = false) => request<TerminalSessionDescriptor>(`/api/sessions/${id}/terminal/sessions?target=${encodeURIComponent(target)}${target === 'host' && confirmHost ? '&confirm_host=true' : ''}`, { method: 'POST', body: JSON.stringify(input) }),
  terminalInput: (id: string, terminalId: string, data: string) => request<void>(`/api/sessions/${id}/terminal/sessions/${encodeURIComponent(terminalId)}/input`, { method: 'POST', body: JSON.stringify({ data }) }),
  resizeTerminal: (id: string, terminalId: string, cols: number, rows: number) => request<void>(`/api/sessions/${id}/terminal/sessions/${encodeURIComponent(terminalId)}/resize`, { method: 'POST', body: JSON.stringify({ cols, rows }) }),
  closeTerminal: (id: string, terminalId: string) => request<void>(`/api/sessions/${id}/terminal/sessions/${encodeURIComponent(terminalId)}`, { method: 'DELETE' }),
  terminalEventsURL: (id: string, terminalId: string) => `${API_URL}/api/sessions/${id}/terminal/sessions/${encodeURIComponent(terminalId)}/events`,
  dockerOverview: (id: string) => request<DockerOverview>(`/api/sessions/${id}/docker`),
  dockerContainerLogs: (id: string, containerId: string, tail = 200) => request<DockerLogs>(`/api/sessions/${id}/docker/containers/${encodeURIComponent(containerId)}/logs?tail=${encodeURIComponent(String(tail))}`),
  dockerContainerAction: (id: string, containerId: string, action: DockerContainerAction) => request<{ status: string; action: DockerContainerAction; container_id: string }>(`/api/sessions/${id}/docker/containers/${encodeURIComponent(containerId)}/${action}`, { method: 'POST', body: '{}' }),
  dockerComposeDown: (id: string, project: string) => request<{ status: string; project: string }>(`/api/sessions/${id}/docker/compose/${encodeURIComponent(project)}/down`, { method: 'POST', body: '{}' }),
  dockerComposeRedeploy: (id: string, project: string) => request<{ status: string; project: string }>(`/api/sessions/${id}/docker/compose/${encodeURIComponent(project)}/redeploy`, { method: 'POST', body: '{}' }),
  dockerResourceRemove: (id: string, kind: DockerResourceKind, name: string) => request<{ status: string; kind: DockerResourceKind; name: string }>(`/api/sessions/${id}/docker/resources/${kind}/${encodeURIComponent(name)}/remove`, { method: 'POST', body: '{}' }),
  resetTerminal: (id: string) => request<{ status: string }>(`/api/sessions/${id}/terminal/reset`, { method: 'POST', body: '{}' }),
  gitOverview: (id: string, repository = '') => request<GitOverview>(gitQuery(`/api/sessions/${id}/git/overview`, repository)).then(normalizeGitOverview),
  gitHead: (id: string, repository = '') => request<GitHeadState>(gitQuery(`/api/sessions/${id}/git/head`, repository)),
  gitFileDiff: (id: string, path: string, repository = '') => request<GitFileDiff>(gitQuery(`/api/sessions/${id}/git/diff?path=${encodeURIComponent(path)}`, repository)),
  gitUnpushed: (id: string, repository = '') => request<GitUnpushedOverview>(gitQuery(`/api/sessions/${id}/git/unpushed`, repository)),
  gitUnpushedCommit: (id: string, sha: string, repository = '') => request<GitCommitDetail>(gitQuery(`/api/sessions/${id}/git/unpushed/${encodeURIComponent(sha)}`, repository)),
  gitHistory: (id: string, refs: string[] = [], all = false, repository = '') => {
    const params = new URLSearchParams()
    if (all) params.set('all', 'true')
    else refs.forEach((ref) => params.append('ref', ref))
    if (repository) params.set('repository', repository)
    const query = params.toString()
    return request<GitCommit[]>(`/api/sessions/${id}/git/history${query ? `?${query}` : ''}`)
  },
  gitHistoryPage: (id: string, refs: string[] = [], all = false, offset = 0, limit = 50, repository = '') => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) })
    if (all) params.set('all', 'true')
    else refs.forEach((ref) => params.append('ref', ref))
    if (repository) params.set('repository', repository)
    return request<GitHistoryPage>(`/api/sessions/${id}/git/history/page?${params.toString()}`)
  },
  gitHistoryCommit: (id: string, sha: string, repository = '') => request<GitCommitDetail>(gitQuery(`/api/sessions/${id}/git/history/${encodeURIComponent(sha)}`, repository)),
  gitContributors: (id: string, repository = '') => request<GitContributorsOverview>(gitQuery(`/api/sessions/${id}/git/contributors`, repository)),
  gitMergeCandidates: (id: string, target: string, repository = '') => request<GitBranch[]>(gitQuery(`/api/sessions/${id}/git/merge-candidates?target=${encodeURIComponent(target)}`, repository)),
  gitCreateBranch: (id: string, branch: string, startPoint: string, repository = '') => request<GitBranchMutationResult>(`/api/sessions/${id}/git/branches`, { method: 'POST', body: JSON.stringify({ branch, start_point: startPoint, repository }) }),
  gitDeleteBranch: (id: string, branch: string, repository = '') => request<GitBranchMutationResult>(`/api/sessions/${id}/git/branches/delete`, { method: 'POST', body: JSON.stringify({ branch, repository, confirmation: 'delete_branch' }) }),
  gitGenerateReleaseNotes: (id: string, branch: string, repository = '') => request<GitReleaseNotesResult>(`/api/sessions/${id}/git/release-notes`, { method: 'POST', body: JSON.stringify({ branch, repository }) }),
  gitCreateRelease: (id: string, input: { branch: string; tag_suffix: string; title: string; body: string }, repository = '') => request<GitReleaseResult>(`/api/sessions/${id}/git/releases`, { method: 'POST', body: JSON.stringify({ ...input, repository, confirmation: 'publish_release' }) }),
  setGitCommitMode: (id: string, mode: GitCommitMode) => request<{ commit_mode: GitCommitMode }>(`/api/sessions/${id}/git/commit-mode`, { method: 'PUT', body: JSON.stringify({ commit_mode: mode }) }),
  setGitConflictStrategy: (id: string, strategy: GitConflictStrategy) => request<{ conflict_strategy: GitConflictStrategy }>(`/api/sessions/${id}/git/conflict-strategy`, { method: 'PUT', body: JSON.stringify({ conflict_strategy: strategy }) }),
  setGitAuthorSettings: (id: string, settings: GitAuthorSettings) => request<GitAuthorSettings>(`/api/sessions/${id}/git/author-settings`, { method: 'PUT', body: JSON.stringify(settings) }),
  gitPendingCommit: (id: string, pendingID: string) => request<GitPendingCommit>(`/api/sessions/${id}/git/pending/${encodeURIComponent(pendingID)}`),
  commitGitPending: (id: string, pendingIDs: string[]) => request<GitCommitResult>(`/api/sessions/${id}/git/pending/commit`, { method: 'POST', body: JSON.stringify({ pending_ids: pendingIDs }) }),
  commitGitWorktree: (id: string, message: string, paths: string[], repository = '', all = false) => request<GitWorktreeCommitResult>(`/api/sessions/${id}/git/worktree/commit`, { method: 'POST', body: JSON.stringify({ message, paths, repository, all }) }),
  discardGitPending: (id: string, pendingIDs: string[]) => request<{ removed: number }>(`/api/sessions/${id}/git/pending/discard`, { method: 'POST', body: JSON.stringify({ pending_ids: pendingIDs }) }),
  // The confirmation token is required by the backend: pushing publishes code
  // to a remote other people read and cannot be undone by a local reset, so it
  // must never be reachable by a stray click or a replayed request.
  gitPush: (id: string, remote: string, branch: string, setUpstream: boolean, repository = '') => request<GitPushResult>(`/api/sessions/${id}/git/push`, { method: 'POST', body: JSON.stringify({ remote, branch, set_upstream: setUpstream, repository, confirmation: 'push' }) }),
  gitPushSelected: (id: string, commitSHAs: string[], repository = '') => request<GitPushResult>(`/api/sessions/${id}/git/push-selected`, { method: 'POST', body: JSON.stringify({ commit_shas: commitSHAs, repository, confirmation: 'push' }) }),
  gitFetch: (id: string, remote: string, repository = '') => request<GitBranchActionResult>(`/api/sessions/${id}/git/fetch`, { method: 'POST', body: JSON.stringify({ remote, repository }) }),
  gitPull: (id: string, remote: string, branch: string, repository = '') => request<GitBranchActionResult>(`/api/sessions/${id}/git/pull`, { method: 'POST', body: JSON.stringify({ remote, branch, repository }) }),
  gitSwitch: (id: string, branch: string, repository = '') => request<GitBranchActionResult>(`/api/sessions/${id}/git/switch`, { method: 'POST', body: JSON.stringify({ branch, repository }) }),
  gitMerge: (id: string, ref: string, repository = '') => request<GitMergeResult>(`/api/sessions/${id}/git/merge`, { method: 'POST', body: JSON.stringify({ ref, repository }) }),
  gitRemoteMerge: (id: string, targetRef: string, sourceRefs: string[], repository = '') => request<GitRemoteMergeResult>(`/api/sessions/${id}/git/remote-merge`, { method: 'POST', body: JSON.stringify({ target_ref: targetRef, source_refs: sourceRefs, repository, confirmation: 'merge_remote' }) }),
  orchestratorOverview: (id: string) => request<OrchestratorOverview>(`/api/sessions/${id}/orchestrator/overview`).then(normalizeOrchestratorOverview),
  proposeOrchestratorPlan: (id: string, objective: string, composer?: { include_context?: boolean; project_files?: string[]; attachment_cache_key?: string; attachments?: Array<{ name: string; size: number; mime: string; storage_ref: string }>; todo_ids?: string[] }) => request<OrchestratorProposalResult>(`/api/sessions/${id}/orchestrator/plans/propose`, { method: 'POST', body: JSON.stringify({ objective, ...composer }) }),
  retryOrchestratorPlanning: (id: string, requestId: string) => request<OrchestratorPlanningRequest>(`/api/sessions/${id}/orchestrator/planning/${encodeURIComponent(requestId)}/retry`, { method: 'POST', body: '{}' }),
  importOrchestratorPlan: (id: string, requestId: string, proposal: OrchestratorProposal) => request<OrchestratorProposalResult>(`/api/sessions/${id}/orchestrator/plans/import`, { method: 'POST', body: JSON.stringify({ request_id: requestId, proposal }) }),
  approveOrchestratorPlan: (id: string, planId: string) => request<OrchestratorOverview>(`/api/sessions/${id}/orchestrator/plans/${encodeURIComponent(planId)}/approve`, { method: 'POST', body: '{}' }).then(normalizeOrchestratorOverview),
  rejectOrchestratorPlan: (id: string, planId: string) => request<OrchestratorOverview>(`/api/sessions/${id}/orchestrator/plans/${encodeURIComponent(planId)}/reject`, { method: 'POST', body: '{}' }).then(normalizeOrchestratorOverview),
  reviseOrchestratorPlan: (id: string, planId: string, guidance: string) => request<OrchestratorProposalResult>(`/api/sessions/${id}/orchestrator/plans/${encodeURIComponent(planId)}/revise`, { method: 'POST', body: JSON.stringify({ guidance }) }),
  createOrchestratorTask: (id: string, input: { plan_id?: string; title: string; description?: string; acceptance_criteria?: string[]; priority?: OrchestratorPriority; depends_on?: string[]; capability?: string }) => request<OrchestratorTask>(`/api/sessions/${id}/orchestrator/tasks`, { method: 'POST', body: JSON.stringify(input) }),
  transitionOrchestratorTask: (id: string, taskId: string, status: OrchestratorTaskStatus) => request<OrchestratorTask>(`/api/sessions/${id}/orchestrator/tasks/${encodeURIComponent(taskId)}/transition`, { method: 'POST', body: JSON.stringify({ status }) }),
  startOrchestratorTask: (id: string, taskId: string) => request<OrchestratorRunResult>(`/api/sessions/${id}/orchestrator/tasks/${encodeURIComponent(taskId)}/start`, { method: 'POST', body: '{}' }),
  orchestratorTaskRuns: (id: string, taskId: string) => request<{ runs: OrchestratorTaskRun[] }>(`/api/sessions/${id}/orchestrator/tasks/${encodeURIComponent(taskId)}/runs`),
  contextInspection: (id: string) => request<ContextInspection>(`/api/sessions/${id}/context/inspection`),
  // Previews one @attach marker exactly as a request would resolve it, so the
  // panel that configures a selection and the request that sends it cannot
  // disagree about what it means.
  attachmentInspection: (id: string, marker: string) => request<AttachmentInspection>(`/api/sessions/${id}/attachment/inspection`, { method: 'POST', body: JSON.stringify({ marker }) }),
  referenceInspection: (id: string, marker: string) => request<AttachmentInspection>(`/api/sessions/${id}/reference/inspection`, { method: 'POST', body: JSON.stringify({ marker }) }),
  // Every project Wharnex has worked on before, open or closed, this session's
  // own project excluded — exactly the candidate set an `@ref` would resolve
  // against at submit time. See internal/app/service_crossproject.go.
  knownProjects: (id: string) => request<{ projects: KnownProjectRef[] }>(`/api/sessions/${id}/known-projects`),
  refreshContext: (id: string) => request<Session>(`/api/sessions/${id}/context/refresh`, { method: 'POST', body: '{}' }),
  projectConfig: (id: string) => request<ProjectConfig>(`/api/sessions/${id}/project-config`),
  updateProjectConfig: (id: string, config: ProjectConfig) => request<{ config: ProjectConfig; session: Session }>(`/api/sessions/${id}/project-config`, { method: 'PUT', body: JSON.stringify(config) }),
  bundleURL: (id: string) => `${API_URL}/api/sessions/${id}/bundle`,
  contextURL: (id: string) => `${API_URL}/api/sessions/${id}/context`,
  eventHistory: (id: string, full = false) => request<{ events: HarnessEvent[]; total: number; truncated: boolean }>(`/api/sessions/${id}/events/history${full ? '?full=1' : ''}`),
  executionErrors: (id: string) => request<{ errors: ExecutionErrorRecord[] }>(`/api/sessions/${id}/execution-errors`),
  eventsURL: (id: string) => `${API_URL}/api/sessions/${id}/events`,
}

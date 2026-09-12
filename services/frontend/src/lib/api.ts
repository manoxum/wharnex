import type { AgentTurn, AppConfig, AttentionRecord, ArtifactEntry, ArtifactPresentation, ArtifactRecord, ArtifactSettings, LanguageCode, LanguageSettings, MarkdownTranslation, AutomationMode, EffortLevel, ChatTransportMode, ChatRequestMode, ChatItem, HarnessEvent, BackendStorageUsage, BundleQuota, BundleSubmission, CommandResult, CommandSpec, ContextInspection, EvolutionEvidence, ExecutionConcurrency, ExecutionMode, ExecutionPlan, ExecutionResult, FileEntry, ProjectConfig, ProjectKnowledge, ProjectProvision, RemoteStorageConfigResponse, RemoteStorageConnection, RemoteStorageDocument, RemoteStorageProvider, RemoteStorageProviderID, OrchestratorOverview, OrchestratorPriority, OrchestratorProposal, OrchestratorProposalResult, OrchestratorRunResult, OrchestratorTask, OrchestratorTaskRun, OrchestratorTaskStatus, Session, TerminalTarget, TunnelProvider, TunnelProviderConfigResponse, TunnelProviderDocument, TunnelProviderEnrollment, TunnelProviderID, TunnelTestResult, WorkspaceFile, GitOverview, GitCommitMode, GitPendingCommit, GitCommitResult, GitPushResult, GitMergeResult, ConflictWorkbench, ConflictManualResolution, ConflictManualResult } from '../types'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8888'

export class APIError extends Error {
  constructor(message: string, public status: number, public data?: unknown) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  }
}

// Same defence as normalizeOrchestratorOverview: a Go backend marshals an
// unallocated slice as null, and this panel maps over every one of these.
export function normalizeGitOverview(overview: GitOverview): GitOverview {
  return {
    ...overview,
    branches: Array.isArray(overview?.branches) ? overview.branches : [],
    remotes: Array.isArray(overview?.remotes) ? overview.remotes : [],
    commits: Array.isArray(overview?.commits) ? overview.commits : [],
    pending: Array.isArray(overview?.pending) ? overview.pending : [],
    working: overview?.working || { clean: true, stageable_count: 0 },
  }
}

export const api = {
  url: API_URL,
  config: () => request<AppConfig>('/api/config'),
  executionConcurrency: () => request<ExecutionConcurrency>('/api/execution-concurrency'),
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
  languageSettings: () => request<LanguageSettings>('/api/language-settings'),
  updateLanguageSettings: (settings: LanguageSettings) => request<LanguageSettings>('/api/language-settings', { method: 'PUT', body: JSON.stringify(settings) }),
  updateArtifactSettings: (retentionDays: number, bundleWindowLimit: number) => request<ArtifactSettings>('/api/artifact-settings', { method: 'PUT', body: JSON.stringify({ retention_days: retentionDays, bundle_window_limit: bundleWindowLimit }) }),
  bundleQuota: () => request<BundleQuota>('/api/bundle-quota'),
  artifacts: (id: string) => request<{ artifacts: ArtifactRecord[] }>(`/api/sessions/${id}/artifacts`),
  exportChat: (id: string, input: ChatExportRequest) => requestDownload(`/api/sessions/${id}/chat-export`, input),
  artifactEntries: (id: string, artifactId: string) => request<{ entries: ArtifactEntry[] }>(`/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}/entries`),
  artifactPresentation: (id: string, artifactId: string) => request<ArtifactPresentation>(`/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}/presentation`),
  persistArtifact: (id: string, input: { request_id: string; direction: 'input' | 'output'; kind: string; filename: string; content_type: string; content_base64: string }) => request<ArtifactRecord>(`/api/sessions/${id}/artifacts`, { method: 'POST', body: JSON.stringify(input) }),
  artifactURL: (id: string, artifactId: string) => `${API_URL}/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}`,
  artifactEntryURL: (id: string, artifactId: string, path: string, download = false) => `${API_URL}/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}/entry?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  storage: () => request<BackendStorageUsage>('/api/storage'),
  clearStorage: (confirm: string) => request<{ status: string }>('/api/storage', { method: 'DELETE', body: JSON.stringify({ confirm }) }),
  createProject: (parentPath: string, name: string) => request<ProjectProvision>('/api/projects/create', { method: 'POST', body: JSON.stringify({ parent_path: parentPath, name }) }),
  cloneProject: (repositoryURL: string, parentPath: string, directory = '') => request<ProjectProvision>('/api/projects/clone', { method: 'POST', body: JSON.stringify({ repository_url: repositoryURL, parent_path: parentPath, directory }) }),
  createSession: (projectPath: string, executionMode: ExecutionMode = 'protected', automationMode: AutomationMode = 'auto', chatId?: string, effortLevel: EffortLevel = 'medium') =>
    request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ project_path: projectPath, execution_mode: executionMode, automation_mode: automationMode, effort_level: effortLevel, chat_id: chatId }) }),
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  workspaceAttention: (projectPath: string) => request<{ records: AttentionRecord[] }>(`/api/workspace-attention?project_path=${encodeURIComponent(projectPath)}`),
  projectKnowledge: (id: string) => request<{ knowledge: ProjectKnowledge | null }>(`/api/sessions/${id}/knowledge`),
  deleteSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
  setExecutionMode: (id: string, executionMode: ExecutionMode) =>
    request<Session>(`/api/sessions/${id}/execution-mode`, { method: 'PUT', body: JSON.stringify({ execution_mode: executionMode }) }),
  setAutomationMode: (id: string, automationMode: AutomationMode) =>
    request<Session>(`/api/sessions/${id}/automation-mode`, { method: 'PUT', body: JSON.stringify({ automation_mode: automationMode }) }),
  setEffortLevel: (id: string, effortLevel: EffortLevel) =>
    request<Session>(`/api/sessions/${id}/effort-level`, { method: 'PUT', body: JSON.stringify({ effort_level: effortLevel }) }),
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
  approvePlan: (id: string, requestId: string) =>
    request<{ session: Session; turn?: AgentTurn; plan?: ExecutionPlan; manual_prompt?: string }>(`/api/sessions/${id}/plans/${encodeURIComponent(requestId)}/approve`, { method: 'POST', body: '{}' }),
  rejectPlan: (id: string, requestId: string) =>
    request<Session>(`/api/sessions/${id}/plans/${encodeURIComponent(requestId)}/reject`, { method: 'POST', body: '{}' }),
  manualPlan: (id: string, rawJSON: string) =>
    request<Session>(`/api/sessions/${id}/manual-plan`, { method: 'POST', body: rawJSON }),
  executionBundle: (id: string, filename: string, contentBase64: string) =>
    request<BundleSubmission>(`/api/sessions/${id}/execution-bundle`, { method: 'POST', body: JSON.stringify({ filename, content_base64: contentBase64 }) }),
  retryPolicyRepair: (id: string) => request<Session>(`/api/sessions/${id}/policy-repair`, { method: 'POST', body: '{}' }),
  requestFailureRepair: (id: string, detail = '') => request<Session>(`/api/sessions/${id}/failure-repair`, { method: 'POST', body: JSON.stringify({ detail }) }),
  retryFailedRequest: (id: string) => request<Session>(`/api/sessions/${id}/failed-request/retry`, { method: 'POST', body: '{}' }),
	cancelPendingRequest: (id: string, requestId: string) => request<Session>(`/api/sessions/${id}/request/cancel`, { method: 'POST', body: JSON.stringify({ request_id: requestId }) }),
	remoteInputFailure: (id: string, requestId: string, reason: string, kind: 'transport' | 'bundle_validation' | 'submodule_write' = 'transport') => request<Session>(`/api/sessions/${id}/remote-input/failures`, { method: 'POST', body: JSON.stringify({ request_id: requestId, reason, kind }) }),
  execute: (id: string, approved: boolean) =>
    request<{ session: Session; result: ExecutionResult }>(`/api/sessions/${id}/execute`, {
      method: 'POST', body: JSON.stringify({ approved }),
    }),
  retryDependencyNetwork: (id: string) => request<Session>(`/api/sessions/${id}/dependency-network-retry`, { method: 'POST', body: JSON.stringify({ approved: true }) }),
  retryHostDependencyRepair: (id: string) => request<Session>(`/api/sessions/${id}/host-dependency-repair`, { method: 'POST', body: JSON.stringify({ approved: true }) }),
  resumeInterruptedExecution: (id: string) => request<{ session: Session; plan_id: string; status: string }>(`/api/sessions/${id}/interrupted-execution/resume`, { method: 'POST', body: '{}' }),
  discardInterruptedExecution: (id: string) => request<Session>(`/api/sessions/${id}/interrupted-execution/discard`, { method: 'POST', body: '{}' }),
  apply: (id: string) => request<Session>(`/api/sessions/${id}/apply`, { method: 'POST', body: '{}' }),
  rejectPendingChanges: (id: string) => request<Session>(`/api/sessions/${id}/pending-changes/reject`, { method: 'POST', body: '{}' }),
  conflictWorkbench: (id: string) => request<ConflictWorkbench>(`/api/sessions/${id}/conflict`),
  resolveConflictManually: (id: string, resolutions: ConflictManualResolution[]) => request<ConflictManualResult>(`/api/sessions/${id}/conflict/manual`, { method: 'POST', body: JSON.stringify({ resolutions }) }),
  delegateConflictToGPT: (id: string, resolutions: ConflictManualResolution[]) => request<Session>(`/api/sessions/${id}/conflict/delegate`, { method: 'POST', body: JSON.stringify({ resolutions }) }),
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
  filePreviewURL: (id: string, path: string) => `${API_URL}/api/sessions/${id}/file/preview?path=${encodeURIComponent(path)}`,
  translateMarkdown: (id: string, targetLanguage: LanguageCode, markdown: string) => request<MarkdownTranslation>(`/api/sessions/${id}/translate-markdown`, { method: 'POST', body: JSON.stringify({ target_language: targetLanguage, markdown }) }),
  writeFile: (id: string, file: Pick<WorkspaceFile, 'path' | 'content' | 'sha256'>) =>
    request<WorkspaceFile>(`/api/sessions/${id}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: file.path, content: file.content, expected_sha256: file.sha256 }),
    }),
  terminal: (id: string, command: CommandSpec, target: TerminalTarget = 'sandbox', confirmHost = false) => request<CommandResult>(`/api/sessions/${id}/terminal?target=${encodeURIComponent(target)}${target === 'host' && confirmHost ? '&confirm_host=true' : ''}`, { method: 'POST', body: JSON.stringify(command) }),
  resetTerminal: (id: string) => request<{ status: string }>(`/api/sessions/${id}/terminal/reset`, { method: 'POST', body: '{}' }),
  gitOverview: (id: string) => request<GitOverview>(`/api/sessions/${id}/git/overview`).then(normalizeGitOverview),
  setGitCommitMode: (id: string, mode: GitCommitMode) => request<{ commit_mode: GitCommitMode }>(`/api/sessions/${id}/git/commit-mode`, { method: 'PUT', body: JSON.stringify({ commit_mode: mode }) }),
  gitPendingCommit: (id: string, pendingID: string) => request<GitPendingCommit>(`/api/sessions/${id}/git/pending/${encodeURIComponent(pendingID)}`),
  commitGitPending: (id: string, pendingIDs: string[]) => request<GitCommitResult>(`/api/sessions/${id}/git/pending/commit`, { method: 'POST', body: JSON.stringify({ pending_ids: pendingIDs }) }),
  discardGitPending: (id: string, pendingIDs: string[]) => request<{ removed: number }>(`/api/sessions/${id}/git/pending/discard`, { method: 'POST', body: JSON.stringify({ pending_ids: pendingIDs }) }),
  // The confirmation token is required by the backend: pushing publishes code
  // to a remote other people read and cannot be undone by a local reset, so it
  // must never be reachable by a stray click or a replayed request.
  gitPush: (id: string, remote: string, branch: string, setUpstream: boolean) => request<GitPushResult>(`/api/sessions/${id}/git/push`, { method: 'POST', body: JSON.stringify({ remote, branch, set_upstream: setUpstream, confirmation: 'push' }) }),
  gitMerge: (id: string, ref: string) => request<GitMergeResult>(`/api/sessions/${id}/git/merge`, { method: 'POST', body: JSON.stringify({ ref }) }),
  orchestratorOverview: (id: string) => request<OrchestratorOverview>(`/api/sessions/${id}/orchestrator/overview`).then(normalizeOrchestratorOverview),
  proposeOrchestratorPlan: (id: string, objective: string) => request<OrchestratorProposalResult>(`/api/sessions/${id}/orchestrator/plans/propose`, { method: 'POST', body: JSON.stringify({ objective }) }),
  importOrchestratorPlan: (id: string, requestId: string, proposal: OrchestratorProposal) => request<OrchestratorProposalResult>(`/api/sessions/${id}/orchestrator/plans/import`, { method: 'POST', body: JSON.stringify({ request_id: requestId, proposal }) }),
  approveOrchestratorPlan: (id: string, planId: string) => request<OrchestratorOverview>(`/api/sessions/${id}/orchestrator/plans/${encodeURIComponent(planId)}/approve`, { method: 'POST', body: '{}' }).then(normalizeOrchestratorOverview),
  createOrchestratorTask: (id: string, input: { plan_id?: string; title: string; description?: string; acceptance_criteria?: string[]; priority?: OrchestratorPriority; depends_on?: string[]; capability?: string }) => request<OrchestratorTask>(`/api/sessions/${id}/orchestrator/tasks`, { method: 'POST', body: JSON.stringify(input) }),
  transitionOrchestratorTask: (id: string, taskId: string, status: OrchestratorTaskStatus) => request<OrchestratorTask>(`/api/sessions/${id}/orchestrator/tasks/${encodeURIComponent(taskId)}/transition`, { method: 'POST', body: JSON.stringify({ status }) }),
  startOrchestratorTask: (id: string, taskId: string) => request<OrchestratorRunResult>(`/api/sessions/${id}/orchestrator/tasks/${encodeURIComponent(taskId)}/start`, { method: 'POST', body: '{}' }),
  orchestratorTaskRuns: (id: string, taskId: string) => request<{ runs: OrchestratorTaskRun[] }>(`/api/sessions/${id}/orchestrator/tasks/${encodeURIComponent(taskId)}/runs`),
  contextInspection: (id: string) => request<ContextInspection>(`/api/sessions/${id}/context/inspection`),
  refreshContext: (id: string) => request<Session>(`/api/sessions/${id}/context/refresh`, { method: 'POST', body: '{}' }),
  projectConfig: (id: string) => request<ProjectConfig>(`/api/sessions/${id}/project-config`),
  updateProjectConfig: (id: string, config: ProjectConfig) => request<{ config: ProjectConfig; session: Session }>(`/api/sessions/${id}/project-config`, { method: 'PUT', body: JSON.stringify(config) }),
  bundleURL: (id: string) => `${API_URL}/api/sessions/${id}/bundle`,
  contextURL: (id: string) => `${API_URL}/api/sessions/${id}/context`,
  eventHistory: (id: string) => request<{ events: HarnessEvent[]; total: number; truncated: boolean }>(`/api/sessions/${id}/events/history`),
  eventsURL: (id: string) => `${API_URL}/api/sessions/${id}/events`,
}

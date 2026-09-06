import type { AgentTurn, AppConfig, ArtifactEntry, ArtifactRecord, ArtifactSettings, AutomationMode, ChatRequestMode, BackendStorageUsage, BundleSubmission, CommandResult, CommandSpec, ContextInspection, EvolutionEvidence, ExecutionMode, ExecutionPlan, ExecutionResult, FileEntry, ProjectConfig, ProjectProvision, RemoteStorageConfigResponse, RemoteStorageConnection, RemoteStorageDocument, RemoteStorageProvider, RemoteStorageProviderID, Session, TerminalTarget, TunnelProvider, TunnelProviderConfigResponse, TunnelProviderDocument, TunnelProviderEnrollment, TunnelProviderID, TunnelTestResult, WorkspaceFile } from '../types'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8080'

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

export const api = {
  url: API_URL,
  config: () => request<AppConfig>('/api/config'),
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
  updateArtifactSettings: (retentionDays: number) => request<ArtifactSettings>('/api/artifact-settings', { method: 'PUT', body: JSON.stringify({ retention_days: retentionDays }) }),
  artifacts: (id: string) => request<{ artifacts: ArtifactRecord[] }>(`/api/sessions/${id}/artifacts`),
  artifactEntries: (id: string, artifactId: string) => request<{ entries: ArtifactEntry[] }>(`/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}/entries`),
  persistArtifact: (id: string, input: { request_id: string; direction: 'input' | 'output'; kind: string; filename: string; content_type: string; content_base64: string }) => request<ArtifactRecord>(`/api/sessions/${id}/artifacts`, { method: 'POST', body: JSON.stringify(input) }),
  artifactURL: (id: string, artifactId: string) => `${API_URL}/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}`,
  artifactEntryURL: (id: string, artifactId: string, path: string, download = false) => `${API_URL}/api/sessions/${id}/artifacts/${encodeURIComponent(artifactId)}/entry?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`,
  storage: () => request<BackendStorageUsage>('/api/storage'),
  clearStorage: (confirm: string) => request<{ status: string }>('/api/storage', { method: 'DELETE', body: JSON.stringify({ confirm }) }),
  createProject: (parentPath: string, name: string) => request<ProjectProvision>('/api/projects/create', { method: 'POST', body: JSON.stringify({ parent_path: parentPath, name }) }),
  cloneProject: (repositoryURL: string, parentPath: string, directory = '') => request<ProjectProvision>('/api/projects/clone', { method: 'POST', body: JSON.stringify({ repository_url: repositoryURL, parent_path: parentPath, directory }) }),
  createSession: (projectPath: string, executionMode: ExecutionMode = 'protected', automationMode: AutomationMode = 'auto') =>
    request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ project_path: projectPath, execution_mode: executionMode, automation_mode: automationMode }) }),
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  deleteSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
  setExecutionMode: (id: string, executionMode: ExecutionMode) =>
    request<Session>(`/api/sessions/${id}/execution-mode`, { method: 'PUT', body: JSON.stringify({ execution_mode: executionMode }) }),
  setAutomationMode: (id: string, automationMode: AutomationMode) =>
    request<Session>(`/api/sessions/${id}/automation-mode`, { method: 'PUT', body: JSON.stringify({ automation_mode: automationMode }) }),
  message: (id: string, message: string, planningMode: ChatRequestMode = 'direct') =>
    request<{ session: Session; turn?: AgentTurn; plan?: ExecutionPlan; manual_prompt?: string }>(`/api/sessions/${id}/messages`, {
      method: 'POST', body: JSON.stringify({ message, planning_mode: planningMode }),
    }),
  manualPlan: (id: string, rawJSON: string) =>
    request<Session>(`/api/sessions/${id}/manual-plan`, { method: 'POST', body: rawJSON }),
  executionBundle: (id: string, filename: string, contentBase64: string) =>
    request<BundleSubmission>(`/api/sessions/${id}/execution-bundle`, { method: 'POST', body: JSON.stringify({ filename, content_base64: contentBase64 }) }),
  retryPolicyRepair: (id: string) => request<Session>(`/api/sessions/${id}/policy-repair`, { method: 'POST', body: '{}' }),
  retryFailedRequest: (id: string) => request<Session>(`/api/sessions/${id}/failed-request/retry`, { method: 'POST', body: '{}' }),
	cancelPendingRequest: (id: string) => request<Session>(`/api/sessions/${id}/request/cancel`, { method: 'POST', body: '{}' }),
	remoteInputFailure: (id: string, requestId: string, reason: string, kind: 'transport' | 'bundle_validation' = 'transport') => request<Session>(`/api/sessions/${id}/remote-input/failures`, { method: 'POST', body: JSON.stringify({ request_id: requestId, reason, kind }) }),
  execute: (id: string, approved: boolean) =>
    request<{ session: Session; result: ExecutionResult }>(`/api/sessions/${id}/execute`, {
      method: 'POST', body: JSON.stringify({ approved }),
    }),
  discardInterruptedExecution: (id: string) => request<Session>(`/api/sessions/${id}/interrupted-execution/discard`, { method: 'POST', body: '{}' }),
  apply: (id: string) => request<Session>(`/api/sessions/${id}/apply`, { method: 'POST', body: '{}' }),
  rejectPendingChanges: (id: string) => request<Session>(`/api/sessions/${id}/pending-changes/reject`, { method: 'POST', body: '{}' }),
  revert: (id: string) => request<Session>(`/api/sessions/${id}/revert`, { method: 'POST', body: '{}' }),
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
  writeFile: (id: string, file: Pick<WorkspaceFile, 'path' | 'content' | 'sha256'>) =>
    request<WorkspaceFile>(`/api/sessions/${id}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: file.path, content: file.content, expected_sha256: file.sha256 }),
    }),
  terminal: (id: string, command: CommandSpec, target: TerminalTarget = 'sandbox', confirmHost = false) => request<CommandResult>(`/api/sessions/${id}/terminal?target=${encodeURIComponent(target)}${target === 'host' && confirmHost ? '&confirm_host=true' : ''}`, { method: 'POST', body: JSON.stringify(command) }),
  resetTerminal: (id: string) => request<{ status: string }>(`/api/sessions/${id}/terminal/reset`, { method: 'POST', body: '{}' }),
  contextInspection: (id: string) => request<ContextInspection>(`/api/sessions/${id}/context/inspection`),
  refreshContext: (id: string) => request<Session>(`/api/sessions/${id}/context/refresh`, { method: 'POST', body: '{}' }),
  projectConfig: (id: string) => request<ProjectConfig>(`/api/sessions/${id}/project-config`),
  updateProjectConfig: (id: string, config: ProjectConfig) => request<{ config: ProjectConfig; session: Session }>(`/api/sessions/${id}/project-config`, { method: 'PUT', body: JSON.stringify(config) }),
  bundleURL: (id: string) => `${API_URL}/api/sessions/${id}/bundle`,
  contextURL: (id: string) => `${API_URL}/api/sessions/${id}/context`,
  eventsURL: (id: string) => `${API_URL}/api/sessions/${id}/events`,
}

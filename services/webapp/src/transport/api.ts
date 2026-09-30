import type {
  AgentProviderState, AgentQueueSummary, AppConfig, Artifact, AttentionRecord, ChatItem, ChatItemWire, EvolutionEvidence, ExecutionError, FileEntry, KnowledgeCatalog, OrchestratorOverview, OrchestratorProposalResult,
  OrchestratorRunResult, PostgresCatalog, PostgresConnection, PostgresQueryResult, ProjectConfig, ProjectHistoryEntry, ProjectTodo, QueueTask, RemoteDispatchInput, RemoteInputConfig, RequestMode, Session, StorageUsage,
  TunnelTestResult, UIPreferences, WorkspaceChat,
} from './contracts'

export class APIError extends Error { constructor(public readonly status: number, message: string) { super(message) } }

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  if (!response.ok) throw new APIError(response.status, (await response.text()) || `HTTP ${response.status}`)
  if (response.status === 204) return undefined as T
  const body = await response.text()
  return (body ? JSON.parse(body) : undefined) as T
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  uiPreferences: () => request<UIPreferences>('/api/ui-preferences'),
  pairingStatus: () => request<{ paired: boolean; remote: boolean }>('/api/pairing/status'),
  claimPairing: (code: string) => request('/api/pairing/claim', { method: 'POST', body: JSON.stringify({ code }) }),
  endPairing: () => request<void>('/api/pairing/session', { method: 'DELETE' }),
  storage: () => request<StorageUsage>('/api/storage'),
  projectHistory: () => request<{ projects: ProjectHistoryEntry[] }>('/api/projects/history'),
  workspaceChats: (project: string) => request<{ chats: WorkspaceChat[] }>(`/api/workspace-chats?project_path=${encodeURIComponent(project)}`),
  saveWorkspaceChat: (chat: WorkspaceChat) => request<WorkspaceChat>(`/api/workspace-chats/${encodeURIComponent(chat.id)}`, { method: 'PUT', body: JSON.stringify(chat) }),
  workspaceChatItems: (chatID: string) => request<{ items: ChatItemWire[] }>(`/api/workspace-chats/${encodeURIComponent(chatID)}/items`),
  replaceWorkspaceChatItems: (chatID: string, items: ChatItem[]) => request(`/api/workspace-chats/${encodeURIComponent(chatID)}/items`, { method: 'PUT', body: JSON.stringify({ items: items.map((item) => ({ id: item.id, chat_id: chatID, created_at: item.createdAt || new Date().toISOString(), payload: item })) }) }),
  setWorkspaceChatArchived: (chatID: string, archived: boolean) => request<WorkspaceChat>(`/api/workspace-chats/${encodeURIComponent(chatID)}/archived`, { method: 'PATCH', body: JSON.stringify({ archived }) }),
  setWorkspaceChatSaved: (chatID: string, saved: boolean) => request<WorkspaceChat>(`/api/workspace-chats/${encodeURIComponent(chatID)}/saved`, { method: 'PATCH', body: JSON.stringify({ saved }) }),
  deleteWorkspaceChat: (chatID: string) => request(`/api/workspace-chats/${encodeURIComponent(chatID)}`, { method: 'DELETE' }),
  createSession: (project: string, chatID: string) => request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ project_path: project, execution_mode: 'protected', automation_mode: 'auto', effort_level: 'high', reasoning_effort: 'high', chat_id: chatID }) }),
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  archiveSession: (id: string) => request<Session>(`/api/sessions/${id}/archive`, { method: 'POST', body: '{}' }),
  restoreSession: (id: string) => request<Session>(`/api/sessions/${id}/restore`, { method: 'POST', body: '{}' }),
  setEffort: (id: string, effort: string) => request<Session>(`/api/sessions/${id}/effort-level`, { method: 'PUT', body: JSON.stringify({ effort_level: effort }) }),
  setReasoning: (id: string, effort: string) => request<Session>(`/api/sessions/${id}/reasoning-effort`, { method: 'PUT', body: JSON.stringify({ reasoning_effort: effort }) }),
  setExecutionMode: (id: string, mode: NonNullable<Session['execution_mode']>) => request<Session>(`/api/sessions/${id}/execution-mode`, { method: 'PUT', body: JSON.stringify({ execution_mode: mode }) }),
  setAutomationMode: (id: string, mode: Session['automation_mode']) => request<Session>(`/api/sessions/${id}/automation-mode`, { method: 'PUT', body: JSON.stringify({ automation_mode: mode }) }),
  setDebugMode: (id: string, enabled: boolean) => request<Session>(`/api/sessions/${id}/debug-mode`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  setChatTransportMode: (id: string, mode: NonNullable<Session['chat_transport_mode']>) => request<Session>(`/api/sessions/${id}/chat-transport-mode`, { method: 'PUT', body: JSON.stringify({ chat_transport_mode: mode }) }),
  setKnowledgeSharing: (id: string, enabled: boolean) => request<Session>(`/api/sessions/${id}/knowledge-sharing`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  setChatID: (id: string, chatID: string) => request<Session>(`/api/sessions/${id}/chat-id`, { method: 'PUT', body: JSON.stringify({ chat_id: chatID }) }),
  message: (id: string, message: string, mode: RequestMode) => request<{ session: Session; manual_prompt?: string }>(`/api/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ message, planning_mode: mode }) }),
  remoteDispatch: (id: string, input: RemoteDispatchInput) => request<{ queued: boolean; task: QueueTask }>(`/api/sessions/${id}/remote-dispatch`, { method: 'POST', body: JSON.stringify(input) }),
  attention: (project: string) => request<{ records: AttentionRecord[] }>(`/api/workspace-attention?project_path=${encodeURIComponent(project)}`),
  tasks: (project: string) => request<{ tasks: QueueTask[] }>(`/api/tasks?project_id=${encodeURIComponent(project)}&limit=100`),
  agentTasks: (project: string) => request<{ tasks: QueueTask[] }>(`/api/chat-agent/tasks?project_id=${encodeURIComponent(project)}&limit=100`),
  todos: (id: string) => request<{ todos: ProjectTodo[] }>(`/api/sessions/${id}/todos`),
  createTodo: (id: string, body: string) => request<ProjectTodo>(`/api/sessions/${id}/todos`, { method: 'POST', body: JSON.stringify({ body }) }),
  updateTodo: (id: string, todoID: string, status: 'open' | 'done') => request<ProjectTodo>(`/api/sessions/${id}/todos/${encodeURIComponent(todoID)}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  files: (id: string) => request<{ files: FileEntry[] }>(`/api/sessions/${id}/files`),
  artifacts: (id: string) => request<{ artifacts: Artifact[] }>(`/api/sessions/${id}/artifacts`),
  managedArtifacts: (query = '', kind = '') => request<{ artifacts: Array<{ session_id: string; project_path: string; chat_id?: string; artifact: Artifact }> }>(`/api/artifacts?q=${encodeURIComponent(query)}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`),
  projectConfig: (id: string) => request<ProjectConfig>(`/api/sessions/${id}/project-config`),
  updateProjectConfig: (id: string, config: ProjectConfig) => request<{ config: ProjectConfig; session: Session }>(`/api/sessions/${id}/project-config`, { method: 'PUT', body: JSON.stringify(config) }),
  knowledge: (id: string) => request<{ catalog: KnowledgeCatalog }>(`/api/sessions/${id}/knowledge/catalog`),
  agentProvider: () => request<AgentProviderState>('/api/chat-agent/provider'),
  agentQueue: (project: string) => request<AgentQueueSummary>(`/api/chat-agent/tasks/summary?project_id=${encodeURIComponent(project)}`),
  executionErrors: (id: string) => request<{ errors: ExecutionError[] }>(`/api/sessions/${id}/execution-errors`),
  evolutionEvidence: (id: string) => request<EvolutionEvidence>(`/api/sessions/${id}/self-evolution/evidence`),
  postgresTest: (connection: PostgresConnection) => request<{ connected: boolean }>('/api/database/postgres/test', { method: 'POST', body: JSON.stringify({ connection }) }),
  postgresCatalog: (connection: PostgresConnection) => request<PostgresCatalog>('/api/database/postgres/catalog', { method: 'POST', body: JSON.stringify({ connection }) }),
  postgresQuery: (connection: PostgresConnection, sql: string, readOnly: boolean) => request<PostgresQueryResult>('/api/database/postgres/query', { method: 'POST', body: JSON.stringify({ connection, sql, read_only: readOnly }) }),
  errors: (id: string) => request<Record<string, unknown>>(`/api/sessions/${id}/execution-errors`),
  evolution: (id: string) => request<Record<string, unknown>>(`/api/sessions/${id}/self-evolution/evidence`),
  eventHistory: (id: string) => request<Record<string, unknown>>(`/api/sessions/${id}/events/history`),
  git: (id: string) => request<Record<string, unknown>>(`/api/sessions/${id}/git/overview`),
  docker: (id: string) => request<Record<string, unknown>>(`/api/sessions/${id}/docker`),
  dockerAction: (id: string, containerID: string, action: 'start' | 'stop' | 'restart') => request(`/api/sessions/${id}/docker/containers/${encodeURIComponent(containerID)}/${action}`, { method: 'POST', body: '{}' }),
  orchestrator: (id: string) => request<OrchestratorOverview>(`/api/sessions/${id}/orchestrator/overview`),
  proposeOrchestrator: (id: string, objective: string) => request<OrchestratorProposalResult>(`/api/sessions/${id}/orchestrator/plans/propose`, { method: 'POST', body: JSON.stringify({ objective, include_context: true }) }),
  approveOrchestrator: (id: string, planID: string) => request<OrchestratorOverview>(`/api/sessions/${id}/orchestrator/plans/${encodeURIComponent(planID)}/approve`, { method: 'POST', body: '{}' }),
  startOrchestratorTask: (id: string, taskID: string) => request<OrchestratorRunResult>(`/api/sessions/${id}/orchestrator/tasks/${encodeURIComponent(taskID)}/start`, { method: 'POST', body: '{}' }),
  testTunnel: (instanceID: string) => request<TunnelTestResult>('/api/tunnel/test', { method: 'POST', body: JSON.stringify({ instance_id: instanceID }) }),
  controlTunnel: (instanceID: string, action: 'pause' | 'stop' | 'resume') => request<{ remote_input: RemoteInputConfig }>('/api/tunnel/control', { method: 'POST', body: JSON.stringify({ instance_id: instanceID, action }) }),
}

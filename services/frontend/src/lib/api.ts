import type { AgentTurn, AppConfig, AutomationMode, BundleSubmission, CommandResult, CommandSpec, ExecutionMode, ExecutionPlan, ExecutionResult, FileEntry, Session, TerminalTarget, WorkspaceFile } from '../types'

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
  createSession: (projectPath: string, executionMode: ExecutionMode = 'protected', automationMode: AutomationMode = 'manual') =>
    request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ project_path: projectPath, execution_mode: executionMode, automation_mode: automationMode }) }),
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  deleteSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
  setExecutionMode: (id: string, executionMode: ExecutionMode) =>
    request<Session>(`/api/sessions/${id}/execution-mode`, { method: 'PUT', body: JSON.stringify({ execution_mode: executionMode }) }),
  setAutomationMode: (id: string, automationMode: AutomationMode) =>
    request<Session>(`/api/sessions/${id}/automation-mode`, { method: 'PUT', body: JSON.stringify({ automation_mode: automationMode }) }),
  message: (id: string, message: string) =>
    request<{ session: Session; turn?: AgentTurn; plan?: ExecutionPlan; manual_prompt?: string }>(`/api/sessions/${id}/messages`, {
      method: 'POST', body: JSON.stringify({ message }),
    }),
  manualPlan: (id: string, rawJSON: string) =>
    request<Session>(`/api/sessions/${id}/manual-plan`, { method: 'POST', body: rawJSON }),
  executionBundle: (id: string, filename: string, contentBase64: string) =>
    request<BundleSubmission>(`/api/sessions/${id}/execution-bundle`, { method: 'POST', body: JSON.stringify({ filename, content_base64: contentBase64 }) }),
  execute: (id: string, approved: boolean) =>
    request<{ session: Session; result: ExecutionResult }>(`/api/sessions/${id}/execute`, {
      method: 'POST', body: JSON.stringify({ approved }),
    }),
  apply: (id: string) => request<Session>(`/api/sessions/${id}/apply`, { method: 'POST', body: '{}' }),
  listFiles: (id: string) => request<{ files: FileEntry[] }>(`/api/sessions/${id}/files`),
  readFile: (id: string, path: string) => request<WorkspaceFile>(`/api/sessions/${id}/file?path=${encodeURIComponent(path)}`),
  writeFile: (id: string, file: Pick<WorkspaceFile, 'path' | 'content' | 'sha256'>) =>
    request<WorkspaceFile>(`/api/sessions/${id}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: file.path, content: file.content, expected_sha256: file.sha256 }),
    }),
  terminal: (id: string, command: CommandSpec, target: TerminalTarget = 'sandbox', confirmHost = false) => request<CommandResult>(`/api/sessions/${id}/terminal?target=${encodeURIComponent(target)}${target === 'host' && confirmHost ? '&confirm_host=true' : ''}`, { method: 'POST', body: JSON.stringify(command) }),
  resetTerminal: (id: string) => request<{ status: string }>(`/api/sessions/${id}/terminal/reset`, { method: 'POST', body: '{}' }),
  refreshContext: (id: string) => request<Session>(`/api/sessions/${id}/context/refresh`, { method: 'POST', body: '{}' }),
  bundleURL: (id: string) => `${API_URL}/api/sessions/${id}/bundle`,
  contextURL: (id: string) => `${API_URL}/api/sessions/${id}/context`,
  eventsURL: (id: string) => `${API_URL}/api/sessions/${id}/events`,
}

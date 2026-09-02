import type { AppConfig, CommandResult, CommandSpec, ExecutionMode, FileEntry, Session, WorkspaceFile } from '../types'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8080'

export class APIError extends Error {
  constructor(message: string, public status: number) {
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
    throw new APIError(message, response.status)
  }
  return data as T
}

export const api = {
  url: API_URL,
  config: () => request<AppConfig>('/api/config'),
  createSession: (projectPath: string, executionMode: ExecutionMode = 'protected') =>
    request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify({ project_path: projectPath, execution_mode: executionMode }) }),
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  deleteSession: (id: string) => request<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
  setExecutionMode: (id: string, executionMode: ExecutionMode) =>
    request<Session>(`/api/sessions/${id}/execution-mode`, { method: 'PUT', body: JSON.stringify({ execution_mode: executionMode }) }),
  message: (id: string, message: string) =>
    request<{ session: Session; manual_prompt?: string }>(`/api/sessions/${id}/messages`, {
      method: 'POST', body: JSON.stringify({ message }),
    }),
  manualPlan: (id: string, rawJSON: string) =>
    request<Session>(`/api/sessions/${id}/manual-plan`, { method: 'POST', body: rawJSON }),
  execute: (id: string, approved: boolean) =>
    request<{ session: Session }>(`/api/sessions/${id}/execute`, {
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
  terminal: (id: string, command: CommandSpec) => request<CommandResult>(`/api/sessions/${id}/terminal`, { method: 'POST', body: JSON.stringify(command) }),
  resetTerminal: (id: string) => request<{ status: string }>(`/api/sessions/${id}/terminal/reset`, { method: 'POST', body: '{}' }),
  refreshContext: (id: string) => request<Session>(`/api/sessions/${id}/context/refresh`, { method: 'POST', body: '{}' }),
  bundleURL: (id: string) => `${API_URL}/api/sessions/${id}/bundle`,
  contextURL: (id: string) => `${API_URL}/api/sessions/${id}/context`,
  eventsURL: (id: string) => `${API_URL}/api/sessions/${id}/events`,
}

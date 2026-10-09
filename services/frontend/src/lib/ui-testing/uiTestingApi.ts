import type { UITestingDocument } from '../../types'
import { API_URL, request } from '../transport/http/apiRequest'

const base = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/ui-testing`

export const uiTestingApi = {
  get: (sessionId: string) => request<UITestingDocument>(base(sessionId)),
  sync: (sessionId: string) => request<UITestingDocument>(`${base(sessionId)}/sync`, { method:'POST', body:'{}' }),
  design: (sessionId: string, input: { brief: string; environment_id?: string }) => request<UITestingDocument>(`${base(sessionId)}/design`, { method:'POST', body:JSON.stringify(input) }),
  dismissDesign: (sessionId: string, taskId: string) => request<UITestingDocument>(`${base(sessionId)}/design/${encodeURIComponent(taskId)}`, { method:'DELETE' }),
  configure: (sessionId: string, input: { environment_id: string; profile_id?: string; url?: string; username?: string; password?: string; notes?: string }) => request<UITestingDocument>(`${base(sessionId)}/config`, { method:'PUT', body:JSON.stringify(input) }),
  run: (sessionId: string, testIds: string[]) => request<{ queued: string[] }>(`${base(sessionId)}/run`, { method:'POST', body:JSON.stringify({ test_ids:testIds }) }),
  clearSessions: (sessionId: string, environmentId: string) => request<UITestingDocument>(`${base(sessionId)}/browser-sessions?environment_id=${encodeURIComponent(environmentId)}`, { method:'DELETE' }),
  asset: (sessionId: string, runId: string, name: string) => `${API_URL}${base(sessionId)}/assets/${encodeURIComponent(runId)}/${encodeURIComponent(name)}`,
}

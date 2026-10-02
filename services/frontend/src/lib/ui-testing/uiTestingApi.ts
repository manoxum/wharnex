import type { UITestingDocument } from '../../types'
import { API_URL, request } from '../transport/http/apiRequest'

export const uiTestingApi = {
  get: (sessionId: string) => request<UITestingDocument>(`/api/sessions/${encodeURIComponent(sessionId)}/ui-testing`),
  sync: (sessionId: string) => request<UITestingDocument>(`/api/sessions/${encodeURIComponent(sessionId)}/ui-testing/sync`, { method:'POST', body:'{}' }),
  configure: (sessionId: string, input: { environment_id: string; profile_id?: string; url?: string; username?: string; password?: string }) => request<UITestingDocument>(`/api/sessions/${encodeURIComponent(sessionId)}/ui-testing/config`, { method:'PUT', body:JSON.stringify(input) }),
  run: (sessionId: string, testIds: string[]) => request<{ queued: string[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/ui-testing/run`, { method:'POST', body:JSON.stringify({ test_ids:testIds }) }),
  asset: (sessionId: string, runId: string, name: string) => `${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/ui-testing/assets/${encodeURIComponent(runId)}/${encodeURIComponent(name)}`,
}

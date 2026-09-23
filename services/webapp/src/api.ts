import type { AppConfig, PairingStatus, RemoteInputConfig, TunnelTestResult } from './types'

export class APIError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  if (!response.ok) {
    const body = await response.text()
    throw new APIError(response.status, body || `HTTP ${response.status}`)
  }
  if (response.status === 204) return undefined as T
  const body = await response.text()
  return (body ? JSON.parse(body) : undefined) as T
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  pairingStatus: () => request<PairingStatus>('/api/pairing/status'),
  claimPairing: (code: string) => request<PairingStatus>('/api/pairing/claim', { method: 'POST', body: JSON.stringify({ code }) }),
  endPairing: () => request<void>('/api/pairing/session', { method: 'DELETE' }),
  testTunnel: (instanceID: string) => request<TunnelTestResult>('/api/tunnel/test', { method: 'POST', body: JSON.stringify({ instance_id: instanceID }) }),
  controlTunnel: (instanceID: string, action: 'pause' | 'stop' | 'resume') => request<{ remote_input: RemoteInputConfig }>('/api/tunnel/control', { method: 'POST', body: JSON.stringify({ instance_id: instanceID, action }) }),
}

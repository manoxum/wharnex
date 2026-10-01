import type { AppConfig, TunnelTestResult } from '../../../types'
import { request } from '../../transport/http/api'

export type TunnelControlAction = 'pause' | 'stop' | 'resume'
export type PairingStart = { pairing_url: string; qr_code: string; expires_at: string }
export type PairingStatus = { paired: boolean; remote: boolean }

export const remoteApi = {
  config: () => request<AppConfig>('/api/config'),
  testTunnel: (instanceID: string) => request<TunnelTestResult>('/api/tunnel/test', { method: 'POST', body: JSON.stringify({ instance_id: instanceID }) }),
  controlTunnel: (instanceID: string, action: TunnelControlAction) => request<{ remote_input: AppConfig['remote_input'] }>('/api/tunnel/control', { method: 'POST', body: JSON.stringify({ instance_id: instanceID, action }) }),
  startPairing: (instanceID: string) => request<PairingStart>('/api/pairing/start', { method: 'POST', body: JSON.stringify({ instance_id: instanceID }) }),
  pairingStatus: () => request<PairingStatus>('/api/pairing/status'),
  claimPairing: (code: string) => request<PairingStatus>('/api/pairing/claim', { method: 'POST', body: JSON.stringify({ code }) }),
  endPairing: () => request<void>('/api/pairing/session', { method: 'DELETE' }),
}

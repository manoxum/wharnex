export type PairingStatus = { paired: boolean; remote: boolean }
export type TunnelState = 'active' | 'paused' | 'stopped' | 'unavailable'
export type TunnelInstance = {
  id: string
  provider: string
  priority: number
  available: boolean
  state?: TunnelState
  public_url?: string
  error?: string
  limits: { max_requests: number; window_seconds: number; max_files_per_input: number; max_file_bytes: number; max_input_bytes: number; max_stored_objects: number; max_storage_bytes: number }
  usage: { requests_in_window: number; stored_objects: number; storage_bytes: number }
}
export type RemoteInputConfig = { enabled: boolean; provider?: string; mode: 'local_attachments' | 'remote_url' | 'tunnel'; instances?: TunnelInstance[] }
export type AppConfig = { version?: string; remote_input?: RemoteInputConfig }
export type TunnelTestResult = { ok: boolean; instance_id: string; public_url: string; latency_ms: number }

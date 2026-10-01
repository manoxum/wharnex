export type RemoteStorageLimits = {
  max_requests: number
  window_seconds: number
  max_files_per_input: number
  max_file_bytes: number
  max_input_bytes: number
  max_stored_objects: number
  max_storage_bytes: number
}

export type RemoteStorageInstance = {
  id: string
  provider: RemoteStorageProviderID
  priority: number
  limits: RemoteStorageLimits
  upload_url?: string
  public_url?: string
  authorization_env?: string
  rclone_remote?: string
  rclone_prefix?: string
}

export type RemoteStorageProviderID = 'http' | 'rclone' | 'drive' | 'dropbox' | 'onedrive' | 's3' | 'webdav' | 'nextcloud' | 'box' | 'pcloud' | 'trycloudflare'
export type RemoteStorageProviderField = { id: string; label: string; placeholder?: string; secret?: boolean; required?: boolean; advanced?: boolean }
export type RemoteStorageProvider = { id: RemoteStorageProviderID; name: string; description: string; auth_mode: 'oauth_browser' | 'credentials' | 'local_tunnel'; available: boolean; fields: RemoteStorageProviderField[] }
export type RemoteStorageConnection = { provider: RemoteStorageProviderID; remote: string; connected: boolean; display_name?: string }

export type RemoteStorageDocument = { version: 1; instances: RemoteStorageInstance[] }
export type RemoteStorageConfigResponse = { config: RemoteStorageDocument; restart_required: boolean; credential_cleanup_warning?: boolean }

export type TunnelProviderID = 'cloudflare_named' | 'ngrok' | 'trycloudflare' | 'zrok' | 'tailscale_funnel' | 'localxpose' | 'localhost_run' | 'pinggy' | 'serveo' | 'pyjamas'
export type TunnelProvider = { id: TunnelProviderID; name: string; description: string; auth_mode: 'token' | 'none' | 'local'; auth_url?: string; permanent_dns: boolean; available: boolean; fields: RemoteStorageProviderField[] }
export type TunnelProviderInstance = { id: string; provider: TunnelProviderID; priority: number; public_url?: string; credential_ref?: string; local_port?: number }
export type TunnelProviderDocument = { version: 1; instance_name?: string; instances: TunnelProviderInstance[] }
export type TunnelProviderConfigResponse = { config: TunnelProviderDocument; restart_required: boolean }
export type TunnelTestResult = { ok: boolean; instance_id: string; public_url: string; latency_ms: number }
export type TunnelProviderEnrollment = { provider: TunnelProviderID; credential_ref: string; public_url: string; local_port?: number }

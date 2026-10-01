export type AppConfig = {
  planner: 'manual' | 'openai' | string
  sandbox: 'docker' | 'local' | string
  model: string
  version?: string
  api_configured: boolean
  chatgpt_web_embed: boolean
  remote_input?: {
    enabled: boolean
    provider?: string
    mode: 'local_attachments' | 'remote_url' | 'tunnel'
    instances?: Array<{
      id: string
      provider: string
      priority: number
      available: boolean
      state?: 'active' | 'paused' | 'stopped' | 'unavailable'
      public_url?: string
      error?: string
      limits: { max_requests: number; window_seconds: number; max_files_per_input: number; max_file_bytes: number; max_input_bytes: number; max_stored_objects: number; max_storage_bytes: number }
      usage: { requests_in_window: number; stored_objects: number; storage_bytes: number }
    }>
  }
}

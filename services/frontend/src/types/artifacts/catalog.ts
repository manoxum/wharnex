export type ActivationImpact = 'backend' | 'frontend' | 'desktop' | 'tunnel'


export type ArtifactRecord = {
  id: string
  request_id?: string
  direction: 'input' | 'output'
  kind: string
  name: string
  content_type?: string
  size: number
  sha256: string
  created_at: string
  expires_at: string
  bundle: boolean
  bundle_type?: string
  entry_count?: number
}

export type ArtifactEntry = { path: string; size: number; dir: boolean }
export type ChatFileRecord = {
  artifact_id: string
  request_id?: string
  direction: 'input' | 'output'
  source: 'attachment' | 'returned' | 'system' | string
  name: string
  path?: string
  content_type?: string
  size: number
  created_at: string
  direct: boolean
}

export type ManagedArtifact = {
  session_id: string
  project_path: string
  chat_id?: string
  artifact: ArtifactRecord
}

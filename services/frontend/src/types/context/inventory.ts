export type ContextExclusion = { path: string; kind: string; reason: string; rule: string }

export type ContextManifest = {
  id: string
  project_root: string
  sha256: string
  files: Array<{ path: string; size: number; sha256: string }>
  excluded: string[]
  excluded_details?: ContextExclusion[]
  text_truncated: boolean
}

export type ContextRule = {
  id: string
  source: string
  label: string
  enabled: boolean
  patterns: string[]
  description: string
}

export type ContextInventoryEntry = {
  path: string
  kind: string
  status: 'included' | 'excluded' | string
  size?: number
  reason?: string
  rule?: string
  created_at?: string
  modified_at?: string
  configurable?: boolean
}

export type ContextRootEntry = {
  path: string
  name: string
  kind: 'file' | 'directory' | string
  status: 'included' | 'excluded' | 'partial' | 'not-in-snapshot' | string
  included_files: number
  excluded_items: number
  included_bytes: number
  reason?: string
  created_at?: string
  modified_at?: string
  configurable?: boolean
}

export type ContextInspection = {
  snapshot_id: string
  sha256: string
  project_root: string
  included_files: number
  excluded_items: number
  included_bytes: number
  roots: ContextRootEntry[]
  entries: ContextInventoryEntry[]
  rules: ContextRule[]
}

/**
 * One `@attach` marker previewed exactly as a request would resolve it.
 *
 * Deliberately the same shape as ContextInspection: an attachment answers the
 * same question about a different root, so the panel that configures it is the
 * one the operator already knows from project settings.
 */
export type AttachmentInspection = {
  root: string
  kind: 'file' | 'directory' | string
  auto_exclude: boolean
  include: string[]
  include_overrides: string[]
  exclude: string[]
  included_files: number
  included_bytes: number
  excluded_items: number
  truncated: boolean
  max_file_bytes: number
  max_total_bytes: number
  max_files: number
  entries: ContextInventoryEntry[]
}

/**
 * A project Wharnex has worked on before, nameable from `@ref` whether or not
 * it is open right now. `open` is a live session holding it — the thing a
 * *change* additionally requires, on top of being merely nameable.
 */
export type KnownProjectRef = {
  name: string
  project_path: string
  open: boolean
}

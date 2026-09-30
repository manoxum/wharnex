// ---------------------------------------------------------------------------
// Git surface
// ---------------------------------------------------------------------------

/**
 * How a project treats its own history once a verified change is applied.
 * `auto` commits the integration immediately; `manual` returns the branch to
 * where the operator left it and keeps the change as uncommitted work, with
 * the planner-authored commit message preserved as a pending record.
 */
export type GitCommitMode = 'auto' | 'manual'
export type GitConflictStrategy = 'gpt_only' | 'user_only' | 'user_decide'
export type GitCommitAuthorStrategy = 'wharnex' | 'git_user' | 'custom' | 'wharnex_git_user' | 'wharnex_custom'
export type GitAuthorSettings = { commit_author_strategy: GitCommitAuthorStrategy; custom_author_name?: string; custom_author_email?: string }

export type GitBranch = {
  name: string
  remote?: string
  current: boolean
  commit_sha: string
  subject?: string
  upstream?: string
  ahead: number
  behind: number
  has_upstream: boolean
  gone: boolean
  counterpart?: string
  has_counterpart?: boolean
  unmerged_commits?: number
}

export type GitRemote = { name: string; url: string }
export type GitTag = { name: string; commit_sha: string; created_at?: string }

export type GitCommit = {
  sha: string
  short_sha: string
  subject: string
  body?: string
  author_name: string
  author_email: string
  committed_at: string
  /** Parent SHAs in Git order; merge commits carry 2+ entries. */
  parents: string[]
  request_id?: string
  plan_id?: string
  /** Originated from a Wharnex change, identified by its Request-Id trailer. */
  wharnex: boolean
  merge: boolean
  /** Reachable from the valid upstream, or from any remote-tracking ref when no upstream exists. */
  pushed: boolean
  files_changed?: number
  additions?: number
  deletions?: number
}

export type GitPendingCommit = {
  id: string
  project_path: string
  session_id?: string
  request_id?: string
  plan_id?: string
  subject: string
  message: string
  paths: string[]
  /** Only populated by the per-record endpoint; the overview omits it. */
  diff?: string
  diff_truncated?: boolean
  created_at: string
}

export type GitWorkingStatus = 'modified' | 'added' | 'deleted' | 'unmerged'

export type GitWorkingFile = {
  path: string
  kind: 'change' | 'gitlink' | 'submodule' | 'embedded_repository' | 'unmerged'
  status: GitWorkingStatus
  additions?: number
  deletions?: number
}

export type GitWorkingSummary = {
  clean: boolean
  stageable_count: number
  files: GitWorkingFile[]
  dirty_submodules?: string[]
  embedded_repositories?: string[]
  unmerged_paths?: string[]
}

export type GitConflictContext = {
  origin: 'integration' | 'push' | 'branch_merge' | 'pull' | 'remote_branch_merge'
  ref: string
  remote?: string
  remote_branch?: string
  base_sha: string
  ours_sha: string
  theirs_sha: string
  target_branch?: string
  source_refs?: string[]
  auto_dispatch?: boolean
}

export type GitFileDiff = { path: string; diff: string; truncated?: boolean }
export type GitOperationPreview = { operation: 'commit' | 'push' | 'pull' | 'merge'; repository: string; from_label: string; to_label: string; from_sha?: string; to_sha?: string; diff: string; truncated?: boolean }

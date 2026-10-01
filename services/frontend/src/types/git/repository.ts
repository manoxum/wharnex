import type { GitAuthorSettings, GitBranch, GitCommit, GitCommitMode, GitConflictContext, GitConflictStrategy, GitPendingCommit, GitRemote, GitTag, GitWorkingSummary } from './changes'

export type GitUnpushedOverview = {
  branch: string
  upstream?: string
  remote?: string
  remote_branch?: string
  has_upstream: boolean
  commits: GitCommit[]
}

export type GitCommitDetail = {
  commit: GitCommit
  diff: string
  diff_truncated?: boolean
}

export type GitHistoryPage = { commits: GitCommit[]; next_offset: number; has_more: boolean }

export type GitContributionWeek = { started_at: string; commits: number; additions: number; deletions: number }
export type GitContributionDay = { started_at: string; commits: number; additions: number; deletions: number }
export type GitContributor = {
  name: string
  email: string
  commits: number
  additions: number
  deletions: number
  first_commit_at: string
  last_commit_at: string
  weekly_commits: number[]
}
export type GitContributorsOverview = {
  contributors: GitContributor[]
  weeks: GitContributionWeek[]
  days: GitContributionDay[]
  total_commits: number
  truncated: boolean
}

export type GitHeadState = {
  current_branch?: string
  detached: boolean
  commit_sha?: string
}

export type GitRepository = {
  path: string
  label: string
  depth: number
  root: boolean
  initialized: boolean
  available: boolean
  unavailable?: string
  current_branch?: string
  detached: boolean
  commit_sha?: string
}

export type GitOverview = {
  project_path: string
  project_version?: string
  repository: string
  repositories: GitRepository[]
  available: boolean
  unavailable?: string
  commit_mode: GitCommitMode
  conflict_strategy?: GitConflictStrategy
  author_settings?: GitAuthorSettings
  /** Self-evolution always commits, so the toggle is presented as fixed. */
  commit_mode_fixed?: boolean
  current_branch?: string
  detached: boolean
  in_progress?: string
  has_identity: boolean
  branches: GitBranch[]
  remotes: GitRemote[]
  tags: GitTag[]
  commits: GitCommit[]
  pending: GitPendingCommit[]
  working: GitWorkingSummary
  conflict?: GitConflictContext
}

export type GitCommitOutcome = { pending_id: string; subject: string; commit_sha?: string; skipped?: string }
export type GitCommitResult = { outcomes: GitCommitOutcome[]; blocked?: string[] }
export type GitWorktreeCommitResult = { commit_sha: string; paths: string[] }
export type GitPushResult = {
  outcome: 'pushed' | 'up_to_date' | 'rejected' | 'auth_required' | 'failed' | 'conflict'
  remote: string
  branch: string
  detail?: string
  integrated?: boolean
  conflict_id?: string
}
export type GitMergeResult = { outcome: string; ref: string; commit_sha?: string; paths?: string[]; conflict_id?: string; detail?: string }
export type GitRemoteMergeResult = { outcome: string; target_ref: string; source_refs: string[]; commit_sha?: string; push_outcome?: string; conflict_ref?: string; conflict_id?: string; paths?: string[]; detail?: string }

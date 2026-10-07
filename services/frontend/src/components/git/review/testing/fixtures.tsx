import { fireEvent, screen } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type { GitOverview, Session } from '../../../../types'


vi.mock('../../../editor/canvas/ChangeDiffEditor', () => ({
  ChangeDiffEditor: ({ file }: { file: { path: string } }) => <div data-testid="change-diff-editor">Comparação estruturada: {file.path}</div>,
}))

vi.mock('../../../../lib/desktop/bridge/appDialog', () => ({ confirmDialog: vi.fn(async () => true) }))

vi.mock('../../../../lib/transport/http/api', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/transport/http/api')>('../../../../lib/transport/http/api')
  return {
    ...actual,
    api: {
      gitOverview: vi.fn(),
      gitHead: vi.fn(),
      gitFileDiff: vi.fn().mockResolvedValue({ path: 'app.go', diff: 'diff --git a/app.go b/app.go\n+changed' }),
      gitUnpushed: vi.fn().mockResolvedValue({ branch: 'main', upstream: 'origin/main', remote: 'origin', remote_branch: 'main', has_upstream: true, commits: [] }),
      gitUnpushedCommit: vi.fn(),
      setGitCommitMode: vi.fn().mockResolvedValue({ commit_mode: 'manual' }),
      gitPendingCommit: vi.fn(),
      commitGitPending: vi.fn().mockResolvedValue({ outcomes: [{ pending_id: 'p1', subject: 'feat: one', commit_sha: 'abc' }] }),
      commitGitWorktree: vi.fn().mockResolvedValue({ commit_sha: 'abcdef123456', paths: ['app.go'] }),
      discardGitPending: vi.fn().mockResolvedValue({ removed: 1 }),
      gitPush: vi.fn().mockResolvedValue({ outcome: 'pushed', remote: 'origin', branch: 'main' }),
      gitPreview: vi.fn(),
      gitPushSelected: vi.fn().mockResolvedValue({ outcome: 'pushed', remote: 'origin', branch: 'main' }),
      gitFetch: vi.fn().mockResolvedValue({ outcome: 'fetched', remote: 'origin' }),
      gitPull: vi.fn().mockResolvedValue({ outcome: 'merged', remote: 'origin', branch: 'main', ref: 'origin/main' }),
      gitSwitch: vi.fn().mockResolvedValue({ outcome: 'switched', branch: 'feature' }),
      gitCreateBranch: vi.fn().mockResolvedValue({ outcome: 'created', branch: 'feature/new' }),
      gitDeleteBranch: vi.fn().mockResolvedValue({ outcome: 'deleted', branch: 'feature' }),
      gitGenerateReleaseNotes: vi.fn().mockResolvedValue({ body: '## Novidades\n- melhoria', commit_count: 2 }),
      gitCreateRelease: vi.fn().mockResolvedValue({ outcome: 'published', remote: 'origin', branch: 'origin/main', tag: 'v1.2.97.3-rc1', commit_sha: 'a1', release_url: 'https://github.com/org/repo/releases/tag/v1.2.97.3-rc1' }),
      gitHistory: vi.fn().mockResolvedValue([]),
      gitHistoryPage: vi.fn().mockResolvedValue({ commits: [], next_offset: 0, has_more: false }),
      gitHistoryCommit: vi.fn(),
      gitContributors: vi.fn(),
      gitMergeCandidates: vi.fn(),
      setGitConflictStrategy: vi.fn().mockResolvedValue({ conflict_strategy: 'user_decide' }),
      setGitAuthorSettings: vi.fn().mockResolvedValue({ commit_author_strategy: 'wharnex_git_user' }),
      delegateConflictToGPT: vi.fn(),
      gitMerge: vi.fn().mockResolvedValue({ outcome: 'merged', ref: 'feature' }),
      gitRemoteMerge: vi.fn().mockResolvedValue({ outcome: 'merged', target_ref: 'origin/main', source_refs: ['origin/feature'], push_outcome: 'pushed' }),
    },
  }
})

export const session = { id: 'ses_1', project_path: '/w/alpha', state: 'ready' } as Session

export function overview(patch: Partial<GitOverview> = {}): GitOverview {
  return {
    project_path: '/w/alpha', available: true, commit_mode: 'manual', detached: false, has_identity: true,
    repository: '', repositories: [],
    current_branch: 'main',
    project_version: 'v1.2.97.3',
    branches: [
      { name: 'main', current: true, commit_sha: 'a1', subject: 'feat: applied by whx', upstream: 'origin/main', ahead: 1, behind: 0, has_upstream: true, gone: false, counterpart: 'origin/main', has_counterpart: true },
      { name: 'feature', current: false, commit_sha: 'a2', subject: 'chore: earlier', ahead: 0, behind: 0, has_upstream: false, gone: false },
      { name: 'origin/main', remote: 'origin', current: false, commit_sha: 'a2', subject: 'chore: earlier', ahead: 1, behind: 0, has_upstream: false, gone: false, counterpart: 'main', has_counterpart: true },
      { name: 'origin/feature', remote: 'origin', current: false, commit_sha: 'a2', subject: 'chore: earlier', ahead: 0, behind: 0, has_upstream: false, gone: false, counterpart: 'feature', has_counterpart: true },
    ],
    remotes: [{ name: 'origin', url: 'https://github.com/org/repo.git' }],
    tags: [{ name: 'v1.2.96.0', commit_sha: 'a2a2a2a2a2a2', created_at: '2026-09-19T10:00:00Z' }],
    commits: [
      { sha: 'a1', short_sha: 'a1', subject: 'feat: applied by whx', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-10T10:00:00Z', parents: ['a2'], wharnex: true, merge: false, pushed: false },
      { sha: 'a2', short_sha: 'a2', subject: 'chore: earlier', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-09T10:00:00Z', parents: [], wharnex: false, merge: false, pushed: true },
    ],
    pending: [
      { id: 'p1', project_path: '/w/alpha', subject: 'feat: one', message: 'feat: one\n\nRequest-Id: req_1', paths: ['a.go'], created_at: '2026-09-10T10:00:00Z' },
      { id: 'p2', project_path: '/w/alpha', subject: 'fix: two', message: 'fix: two', paths: ['b.go'], created_at: '2026-09-10T11:00:00Z' },
    ],
    working: { clean: false, stageable_count: 2, files: [{ path: 'app.go', kind: 'change', status: 'modified' }, { path: 'new.ts', kind: 'change', status: 'added' }] },
    ...patch,
  }
}

export function openTab(name: 'Alterações' | 'Histórico' | 'Contribuidores' | 'Branches' | 'Definições') {
  const tabs = screen.getByRole('tablist', { name: 'Secções do Git' })
  const tab = Array.from(tabs.querySelectorAll<HTMLButtonElement>('[role=tab]')).find((candidate) => candidate.textContent?.includes(name))
  if (!tab) throw new Error(`tab ${name} not found`)
  fireEvent.click(tab)
}

export function openChangesTab(name: 'Alterações pendentes' | 'Commits pendentes') {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(name) }))
}

export async function confirmGitReview() {
  const confirm = await screen.findByRole('button', { name: 'Confirmar e continuar' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)
}

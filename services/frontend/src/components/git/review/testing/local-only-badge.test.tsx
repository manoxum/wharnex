import { overview, session, openChangesTab, confirmGitReview } from './fixtures'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { GitDrawer } from '../GitDrawer'
import { api } from '../../../../lib/transport/http/api'
beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.gitOverview).mockResolvedValue(overview())
    vi.mocked(api.gitHead).mockResolvedValue({ current_branch: 'main', detached: false, commit_sha: 'a1' })
    vi.mocked(api.gitUnpushed).mockResolvedValue({ branch: 'main', upstream: 'origin/main', remote: 'origin', remote_branch: 'main', has_upstream: true, commits: [] })
    vi.mocked(api.gitPreview).mockImplementation(async (_id, input) => ({ operation: input.operation, repository: input.repository || '', from_label: 'Antes', to_label: 'Depois', diff: '' }))
    vi.mocked(api.gitHistoryPage).mockResolvedValue({ commits: overview().commits, next_offset: overview().commits.length, has_more: false })
    vi.mocked(api.gitContributors).mockResolvedValue({
      total_commits: 5, truncated: false,
      weeks: [
        { started_at: '2026-08-31T00:00:00Z', commits: 2, additions: 18, deletions: 3 },
        { started_at: '2026-09-07T00:00:00Z', commits: 3, additions: 27, deletions: 5 },
      ],
      days: [
        { started_at: '2026-08-31T00:00:00Z', commits: 1, additions: 8, deletions: 1 },
        { started_at: '2026-09-01T00:00:00Z', commits: 1, additions: 10, deletions: 2 },
        { started_at: '2026-09-07T00:00:00Z', commits: 1, additions: 7, deletions: 1 },
        { started_at: '2026-09-08T00:00:00Z', commits: 1, additions: 9, deletions: 2 },
        { started_at: '2026-09-10T00:00:00Z', commits: 1, additions: 11, deletions: 2 },
      ],
      contributors: [
        { name: 'Ana Costa', email: 'ana@example.test', commits: 3, additions: 32, deletions: 6, first_commit_at: '2026-08-31T10:00:00Z', last_commit_at: '2026-09-10T10:00:00Z', weekly_commits: [1, 2] },
        { name: 'Bruno Lima', email: 'bruno@example.test', commits: 2, additions: 13, deletions: 2, first_commit_at: '2026-09-01T10:00:00Z', last_commit_at: '2026-09-08T10:00:00Z', weekly_commits: [1, 1] },
      ],
    })
    vi.mocked(api.gitMergeCandidates).mockImplementation(async (_id, target) => overview().branches.filter((branch) => branch.name !== target).map((branch) => ({ ...branch, unmerged_commits: 1 })))
  })
it('lists local-only commits without an upstream and keeps selective push disabled', async () => {
    const base = { sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', short_sha: 'aaaaaaa', subject: 'chore: published base', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-10T10:00:00Z', parents: [], wharnex: false, merge: false, pushed: true }
    const local = { sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', short_sha: 'bbbbbbb', subject: 'fix: local unpublished commit', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-11T10:00:00Z', parents: [base.sha], wharnex: false, merge: false, pushed: false }
    vi.mocked(api.gitOverview).mockResolvedValue(overview({
      current_branch: 'fix/no-upstream',
      branches: [
        { name: 'fix/no-upstream', current: true, commit_sha: local.sha, subject: local.subject, ahead: 0, behind: 0, has_upstream: false, gone: false },
        { name: 'origin/main', remote: 'origin', current: false, commit_sha: base.sha, subject: base.subject, ahead: 0, behind: 0, has_upstream: false, gone: false },
      ],
      commits: [local, base],
    }))
    vi.mocked(api.gitUnpushed).mockResolvedValue({ branch: 'fix/no-upstream', has_upstream: false, commits: [local] })

    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    const tab = Array.from(screen.getByRole('tablist', { name: 'Secções do Git' }).querySelectorAll<HTMLButtonElement>('[role=tab]')).find((candidate) => candidate.textContent?.includes('Alterações'))
    expect(tab?.querySelector('[data-tab-badge]')?.textContent).toBe('3')
    expect(screen.queryByRole('tab', { name: /Por publicar/ })).toBeNull()

    openChangesTab('Commits pendentes')
    expect(await screen.findByText('fix: local unpublished commit')).toBeTruthy()
    expect(screen.getByText(/Sem upstream, estes são os commits locais/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Push selecionado/ })).toBeNull()
    expect((screen.getByRole('checkbox', { name: 'Selecionar fix: local unpublished commit' }) as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Push completo/ }))
    await confirmGitReview()
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledWith('ses_1', 'origin', 'fix/no-upstream', true, ''))
  })

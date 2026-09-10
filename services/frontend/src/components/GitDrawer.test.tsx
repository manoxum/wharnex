import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitOverview, Session } from '../types'
import { api } from '../lib/api'
import { GitDrawer } from './GitDrawer'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    api: {
      gitOverview: vi.fn(),
      setGitCommitMode: vi.fn().mockResolvedValue({ commit_mode: 'manual' }),
      gitPendingCommit: vi.fn(),
      commitGitPending: vi.fn().mockResolvedValue({ outcomes: [{ pending_id: 'p1', subject: 'feat: one', commit_sha: 'abc' }] }),
      discardGitPending: vi.fn().mockResolvedValue({ removed: 1 }),
      gitPush: vi.fn().mockResolvedValue({ outcome: 'pushed', remote: 'origin', branch: 'main' }),
      gitMerge: vi.fn().mockResolvedValue({ outcome: 'merged', ref: 'feature' }),
    },
  }
})

const session = { id: 'ses_1', project_path: '/w/alpha', state: 'ready' } as Session

function overview(patch: Partial<GitOverview> = {}): GitOverview {
  return {
    project_path: '/w/alpha', available: true, commit_mode: 'manual', detached: false, has_identity: true,
    current_branch: 'main',
    branches: [
      { name: 'main', current: true, commit_sha: 'aaa', subject: 'initial', upstream: 'origin/main', ahead: 1, behind: 0, has_upstream: true, gone: false },
      { name: 'feature', current: false, commit_sha: 'bbb', subject: 'feat: work', ahead: 0, behind: 0, has_upstream: false, gone: false },
      { name: 'origin/main', remote: 'origin', current: false, commit_sha: 'ccc', subject: 'initial', ahead: 0, behind: 0, has_upstream: false, gone: false },
    ],
    remotes: [{ name: 'origin', url: 'https://github.com/org/repo.git' }],
    commits: [
      { sha: 'a1', short_sha: 'a1', subject: 'feat: applied by whx', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-10T10:00:00Z', wharnex: true, merge: false, pushed: false },
      { sha: 'a2', short_sha: 'a2', subject: 'chore: earlier', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-09T10:00:00Z', wharnex: false, merge: false, pushed: true },
    ],
    pending: [
      { id: 'p1', project_path: '/w/alpha', subject: 'feat: one', message: 'feat: one\n\nRequest-Id: req_1', paths: ['a.go'], created_at: '2026-09-10T10:00:00Z' },
      { id: 'p2', project_path: '/w/alpha', subject: 'fix: two', message: 'fix: two', paths: ['b.go'], created_at: '2026-09-10T11:00:00Z' },
    ],
    working: { clean: false, stageable_count: 2 },
    ...patch,
  }
}

describe('GitDrawer', () => {
  beforeEach(() => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview())
    vi.clearAllMocks()
    vi.mocked(api.gitOverview).mockResolvedValue(overview())
  })

  it('shows the current branch, pending commits and history', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    // "main" appears as the current branch and again in the branch list, so
    // the unique history entry is the anchor for the initial render.
    expect(await screen.findByText('feat: applied by whx')).toBeTruthy()
    expect(screen.getAllByText('main').length).toBeGreaterThan(0)
    expect(screen.getByText('feat: work')).toBeTruthy()
    expect(screen.getByText('feat: one')).toBeTruthy()
    expect(screen.getByText('fix: two')).toBeTruthy()
    // Remote-tracking branches are listed so a merge target can be chosen.
    expect(screen.getByRole('option', { name: 'origin/main' })).toBeTruthy()
  })

  it('toggles the commit mode', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    fireEvent.click(await screen.findByRole('button', { name: /Auto-commit/ }))
    await waitFor(() => expect(api.setGitCommitMode).toHaveBeenCalledWith('ses_1', 'auto'))
  })

  it('commits every pending record, or only the selected ones', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    fireEvent.click(await screen.findByRole('button', { name: /Commitar todos/ }))
    await waitFor(() => expect(api.commitGitPending).toHaveBeenCalledWith('ses_1', []))

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(screen.getByRole('button', { name: /Commitar selecionados \(1\)/ }))
    await waitFor(() => expect(api.commitGitPending).toHaveBeenCalledWith('ses_1', ['p2']))
  })

  // Discarding drops Wharnex's note about a change, never the change itself,
  // so the affordance must say so rather than reading as a delete.
  it('labels discarding as removing only the record', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    const discard = (await screen.findAllByRole('button', { name: /Descartar registo/ }))[0]
    expect(discard.getAttribute('title')).toContain('ficheiros ficam intactos')
    fireEvent.click(discard)
    await waitFor(() => expect(api.discardGitPending).toHaveBeenCalledWith('ses_1', ['p1']))
  })

  it('pushes the current branch and reports the outcome', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    fireEvent.click(await screen.findByRole('button', { name: /Push para origin\/main/ }))
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledWith('ses_1', 'origin', 'main', false))
    expect((await screen.findByRole('status')).textContent).toContain('Push concluído')
  })

  it('explains that a push conflict published nothing', async () => {
    vi.mocked(api.gitPush).mockResolvedValue({ outcome: 'conflict', remote: 'origin', branch: 'main', conflict_id: 'cf_1' })
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    fireEvent.click(await screen.findByRole('button', { name: /Push para origin\/main/ }))
    expect((await screen.findByRole('status')).textContent).toContain('Nada foi publicado')
  })

  it('merges the chosen branch', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    const select = await screen.findByRole('combobox', { name: 'Branch a fazer merge' })
    fireEvent.change(select, { target: { value: 'feature' } })
    fireEvent.click(screen.getByRole('button', { name: /Merge/ }))
    await waitFor(() => expect(api.gitMerge).toHaveBeenCalledWith('ses_1', 'feature'))
  })

  it('warns when the repository has no Git identity for manual commits', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ has_identity: false }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect(await screen.findByText(/não tem/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Commitar todos/ }).hasAttribute('disabled')).toBe(true)
  })

  // Self-evolution always commits, so offering a toggle Apply would override
  // would be a lie about what the button does.
  it('locks the toggle when the project always commits', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ commit_mode: 'auto', commit_mode_fixed: true }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    const manual = await screen.findByRole('button', { name: /Sem auto-commit/ })
    expect(manual.hasAttribute('disabled')).toBe(true)
  })

  it('explains itself when the repository cannot be inspected', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ available: false, unavailable: 'git executable not found' }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect(await screen.findByText(/git executable not found/)).toBeTruthy()
  })
})

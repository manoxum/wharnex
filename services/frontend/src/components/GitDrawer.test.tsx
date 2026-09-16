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
      gitFileDiff: vi.fn().mockResolvedValue({ path: 'app.go', diff: 'diff --git a/app.go b/app.go\n+changed' }),
      gitUnpushed: vi.fn().mockResolvedValue({ branch: 'main', upstream: 'origin/main', remote: 'origin', remote_branch: 'main', has_upstream: true, commits: [] }),
      gitUnpushedCommit: vi.fn(),
      setGitCommitMode: vi.fn().mockResolvedValue({ commit_mode: 'manual' }),
      gitPendingCommit: vi.fn(),
      commitGitPending: vi.fn().mockResolvedValue({ outcomes: [{ pending_id: 'p1', subject: 'feat: one', commit_sha: 'abc' }] }),
      discardGitPending: vi.fn().mockResolvedValue({ removed: 1 }),
      gitPush: vi.fn().mockResolvedValue({ outcome: 'pushed', remote: 'origin', branch: 'main' }),
      gitPushSelected: vi.fn().mockResolvedValue({ outcome: 'pushed', remote: 'origin', branch: 'main' }),
      gitFetch: vi.fn().mockResolvedValue({ outcome: 'fetched', remote: 'origin' }),
      gitPull: vi.fn().mockResolvedValue({ outcome: 'merged', remote: 'origin', branch: 'main', ref: 'origin/main' }),
      gitSwitch: vi.fn().mockResolvedValue({ outcome: 'switched', branch: 'feature' }),
      gitHistory: vi.fn().mockResolvedValue([]),
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
      { name: 'main', current: true, commit_sha: 'a1', subject: 'feat: applied by whx', upstream: 'origin/main', ahead: 1, behind: 0, has_upstream: true, gone: false },
      { name: 'feature', current: false, commit_sha: 'a2', subject: 'chore: earlier', ahead: 0, behind: 0, has_upstream: false, gone: false },
      { name: 'origin/main', remote: 'origin', current: false, commit_sha: 'a2', subject: 'chore: earlier', ahead: 0, behind: 0, has_upstream: false, gone: false },
    ],
    remotes: [{ name: 'origin', url: 'https://github.com/org/repo.git' }],
    commits: [
      { sha: 'a1', short_sha: 'a1', subject: 'feat: applied by whx', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-10T10:00:00Z', parents: ['a2'], wharnex: true, merge: false, pushed: false },
      { sha: 'a2', short_sha: 'a2', subject: 'chore: earlier', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-09T10:00:00Z', parents: [], wharnex: false, merge: false, pushed: true },
    ],
    pending: [
      { id: 'p1', project_path: '/w/alpha', subject: 'feat: one', message: 'feat: one\n\nRequest-Id: req_1', paths: ['a.go'], created_at: '2026-09-10T10:00:00Z' },
      { id: 'p2', project_path: '/w/alpha', subject: 'fix: two', message: 'fix: two', paths: ['b.go'], created_at: '2026-09-10T11:00:00Z' },
    ],
    working: { clean: false, stageable_count: 2, files: [{ path: 'app.go', kind: 'change' }, { path: 'new.ts', kind: 'change' }] },
    ...patch,
  }
}

function openTab(name: 'Alterações' | 'Por publicar' | 'Histórico' | 'Branches' | 'Definições') {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(name) }))
}

describe('GitDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.gitOverview).mockResolvedValue(overview())
  })

  it('organizes changes, unpublished commits, history, branches and settings into dedicated tabs', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect(await screen.findByText('feat: one')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Alterações/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('feat: applied by whx')).toBeNull()

    expect(screen.getByRole('tab', { name: /Por publicar/ })).toBeTruthy()

    openTab('Histórico')
    expect(screen.getByText('feat: applied by whx')).toBeTruthy()
    expect(document.querySelector('.git-commit-graph')).toBeTruthy()
    expect(screen.getByText('WHX')).toBeTruthy()

    openTab('Branches')
    expect(screen.getAllByText('main').length).toBeGreaterThan(0)
    expect(screen.getAllByText('feature').length).toBeGreaterThan(0)
    expect(screen.getByRole('option', { name: 'origin/main' })).toBeTruthy()

    openTab('Definições')
    expect(screen.getByRole('group', { name: 'Modo de commit' })).toBeTruthy()
    expect(screen.getByText('https://github.com/org/repo.git')).toBeTruthy()
  })


  it('lists changed worktree files and opens their current diff in auto-commit or manual mode', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ commit_mode: 'auto', pending: [] }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect(await screen.findByText('Ficheiros alterados')).toBeTruthy()
    expect(screen.getByText('app.go')).toBeTruthy()
    const diffButtons = screen.getAllByRole('button', { name: /Diff/ })
    fireEvent.click(diffButtons[0])
    await waitFor(() => expect(api.gitFileDiff).toHaveBeenCalledWith('ses_1', 'app.go'))
    expect(await screen.findByRole('dialog', { name: 'Diff de app.go' })).toBeTruthy()
    expect(screen.getByText(/\+changed/)).toBeTruthy()
  })

  it('shows unpublished commits with details and publishes only the selected oldest prefix', async () => {
    const oldest = { sha: '1111111111111111111111111111111111111111', short_sha: '1111111', subject: 'feat: oldest unpublished', body: 'Old body', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-10T10:00:00Z', parents: ['0000000000000000000000000000000000000000'], request_id: 'req_1', plan_id: 'plan_1', wharnex: true, merge: false, pushed: false }
    const newest = { sha: '2222222222222222222222222222222222222222', short_sha: '2222222', subject: 'fix: newest unpublished', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-11T10:00:00Z', parents: [oldest.sha], request_id: 'req_2', plan_id: 'plan_2', wharnex: true, merge: false, pushed: false }
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ branches: overview().branches.map((branch) => branch.name === 'main' ? { ...branch, ahead: 2, commit_sha: newest.sha } : branch) }))
    vi.mocked(api.gitUnpushed).mockResolvedValue({ branch: 'main', upstream: 'origin/main', remote: 'origin', remote_branch: 'main', has_upstream: true, commits: [newest, oldest] })
    vi.mocked(api.gitUnpushedCommit).mockResolvedValue({ commit: newest, diff: 'diff --git a/new.ts b/new.ts\n+fixed' })

    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('feat: one')
    openTab('Por publicar')
    expect(await screen.findByText('fix: newest unpublished')).toBeTruthy()
    expect(screen.getByText('feat: oldest unpublished')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(screen.getByRole('button', { name: /Push selecionado \(1\)/ }))
    await waitFor(() => expect(api.gitPushSelected).toHaveBeenCalledWith('ses_1', [oldest.sha]))

    fireEvent.click(screen.getAllByRole('button', { name: /Detalhes/ })[0])
    await waitFor(() => expect(api.gitUnpushedCommit).toHaveBeenCalledWith('ses_1', newest.sha))
    expect(await screen.findByRole('dialog', { name: 'Commit 2222222' })).toBeTruthy()
    expect(screen.getByText(/Request/)).toBeTruthy()
    expect(screen.getByText(/\+fixed/)).toBeTruthy()
  })

  it('loads selected and all-branch commit timelines', async () => {
    vi.mocked(api.gitHistory).mockResolvedValue([{ sha: 'f1', short_sha: 'f1', subject: 'feat: feature timeline', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-11T10:00:00Z', parents: ['a2'], wharnex: false, merge: false, pushed: false }])
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('feat: one')
    openTab('Histórico')

    const branchSelect = screen.getByRole('listbox', { name: 'Branches do histórico' }) as HTMLSelectElement
    const featureOption = screen.getByRole('option', { name: 'feature' }) as HTMLOptionElement
    featureOption.selected = true
    fireEvent.change(branchSelect)
    await waitFor(() => expect(api.gitHistory).toHaveBeenCalledWith('ses_1', ['feature'], false))
    expect(await screen.findByText('feat: feature timeline')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Todas' }))
    await waitFor(() => expect(api.gitHistory).toHaveBeenCalledWith('ses_1', [], true))
  })

  it('fetches, pulls and switches branches from version control', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('feat: one')
    openTab('Branches')

    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }))
    await waitFor(() => expect((screen.getByRole('button', { name: /Pull/ }) as HTMLButtonElement).disabled).toBe(false))
    expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin')

    fireEvent.click(screen.getByRole('button', { name: /Pull/ }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Alternar' }) as HTMLButtonElement).disabled).toBe(false))
    expect(api.gitPull).toHaveBeenCalledWith('ses_1', 'origin', 'main')

    fireEvent.click(screen.getByRole('button', { name: 'Alternar' }))
    await waitFor(() => expect(api.gitSwitch).toHaveBeenCalledWith('ses_1', 'feature'))
  })

  it('toggles the commit mode from settings', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('feat: one')
    openTab('Definições')
    fireEvent.click(screen.getByRole('button', { name: /Auto-commit/ }))
    await waitFor(() => expect(api.setGitCommitMode).toHaveBeenCalledWith('ses_1', 'auto'))
  })

  it('commits every pending record, or only the selected ones', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    fireEvent.click(await screen.findByRole('button', { name: /Commitar todos/ }))
    await waitFor(() => expect(api.commitGitPending).toHaveBeenCalledWith('ses_1', []))

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(screen.getByRole('button', { name: /Selecionados \(1\)/ }))
    await waitFor(() => expect(api.commitGitPending).toHaveBeenCalledWith('ses_1', ['p2']))
  })

  it('labels discarding as removing only the record', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    const discard = (await screen.findAllByRole('button', { name: /Descartar registo/ }))[0]
    expect(discard.getAttribute('title')).toContain('ficheiros ficam intactos')
    fireEvent.click(discard)
    await waitFor(() => expect(api.discardGitPending).toHaveBeenCalledWith('ses_1', ['p1']))
  })

  it('pushes the current branch and reports the outcome', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('feat: one')
    openTab('Branches')
    fireEvent.click(screen.getByRole('button', { name: /Push/ }))
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledWith('ses_1', 'origin', 'main', false))
    expect((await screen.findByRole('status')).textContent).toContain('Push concluído')
  })

  it('explains that a push conflict published nothing', async () => {
    vi.mocked(api.gitPush).mockResolvedValue({ outcome: 'conflict', remote: 'origin', branch: 'main', conflict_id: 'cf_1' })
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('feat: one')
    openTab('Branches')
    fireEvent.click(screen.getByRole('button', { name: /Push/ }))
    expect((await screen.findByRole('status')).textContent).toContain('Nada foi publicado')
  })

  it('merges the chosen branch', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('feat: one')
    openTab('Branches')
    const select = screen.getByRole('combobox', { name: 'Branch a fazer merge' })
    fireEvent.change(select, { target: { value: 'feature' } })
    fireEvent.click(screen.getByRole('button', { name: /Merge/ }))
    await waitFor(() => expect(api.gitMerge).toHaveBeenCalledWith('ses_1', 'feature'))
  })

  it('warns when the repository has no Git identity for manual commits', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ has_identity: false }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect((await screen.findByRole('button', { name: /Commitar todos/ })).hasAttribute('disabled')).toBe(true)
    openTab('Definições')
    expect(screen.getByText(/não tem/)).toBeTruthy()
  })

  it('locks the toggle when the project always commits', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ commit_mode: 'auto', commit_mode_fixed: true }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('feat: one')
    openTab('Definições')
    const manual = screen.getByRole('button', { name: /Sem auto-commit/ })
    expect(manual.hasAttribute('disabled')).toBe(true)
  })

  it('explains itself when the repository cannot be inspected', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ available: false, unavailable: 'git executable not found' }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect(await screen.findByText(/git executable not found/)).toBeTruthy()
  })
})

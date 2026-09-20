import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitOverview, Session } from '../types'
import { api } from '../lib/api'
import { GitDrawer } from './GitDrawer'

vi.mock('./ChangeDiffEditor', () => ({
  ChangeDiffEditor: ({ file }: { file: { path: string } }) => <div data-testid="change-diff-editor">Comparação estruturada: {file.path}</div>,
}))

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
      commitGitWorktree: vi.fn().mockResolvedValue({ commit_sha: 'abcdef123456', paths: ['app.go'] }),
      discardGitPending: vi.fn().mockResolvedValue({ removed: 1 }),
      gitPush: vi.fn().mockResolvedValue({ outcome: 'pushed', remote: 'origin', branch: 'main' }),
      gitPushSelected: vi.fn().mockResolvedValue({ outcome: 'pushed', remote: 'origin', branch: 'main' }),
      gitFetch: vi.fn().mockResolvedValue({ outcome: 'fetched', remote: 'origin' }),
      gitPull: vi.fn().mockResolvedValue({ outcome: 'merged', remote: 'origin', branch: 'main', ref: 'origin/main' }),
      gitSwitch: vi.fn().mockResolvedValue({ outcome: 'switched', branch: 'feature' }),
      gitHistory: vi.fn().mockResolvedValue([]),
      gitMerge: vi.fn().mockResolvedValue({ outcome: 'merged', ref: 'feature' }),
      gitRemoteMerge: vi.fn().mockResolvedValue({ outcome: 'merged', target_ref: 'origin/main', source_refs: ['origin/feature'], push_outcome: 'pushed' }),
    },
  }
})

const session = { id: 'ses_1', project_path: '/w/alpha', state: 'ready' } as Session

function overview(patch: Partial<GitOverview> = {}): GitOverview {
  return {
    project_path: '/w/alpha', available: true, commit_mode: 'manual', detached: false, has_identity: true,
    current_branch: 'main',
    branches: [
      { name: 'main', current: true, commit_sha: 'a1', subject: 'feat: applied by whx', upstream: 'origin/main', ahead: 1, behind: 0, has_upstream: true, gone: false, counterpart: 'origin/main', has_counterpart: true },
      { name: 'feature', current: false, commit_sha: 'a2', subject: 'chore: earlier', ahead: 0, behind: 0, has_upstream: false, gone: false },
      { name: 'origin/main', remote: 'origin', current: false, commit_sha: 'a2', subject: 'chore: earlier', ahead: 1, behind: 0, has_upstream: false, gone: false, counterpart: 'main', has_counterpart: true },
      { name: 'origin/feature', remote: 'origin', current: false, commit_sha: 'a2', subject: 'chore: earlier', ahead: 0, behind: 0, has_upstream: false, gone: false, counterpart: 'feature', has_counterpart: true },
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

function openTab(name: 'Alterações' | 'Histórico' | 'Branches' | 'Definições') {
  const tabs = screen.getByRole('tablist', { name: 'Secções do Git' })
  const tab = Array.from(tabs.querySelectorAll<HTMLButtonElement>('[role=tab]')).find((candidate) => candidate.textContent?.includes(name))
  if (!tab) throw new Error(`tab ${name} not found`)
  fireEvent.click(tab)
}

function openChangesTab(name: 'Alterações pendentes' | 'Commits pendentes') {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(name) }))
}

describe('GitDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.gitOverview).mockResolvedValue(overview())
  })

  it('separates worktree changes from pending commits while keeping the other Git areas dedicated', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect(await screen.findByText('Ficheiros alterados')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Alterações pendentes/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByText('feat: one')).toBeNull()
    openChangesTab('Commits pendentes')
    expect(await screen.findByText('feat: one')).toBeTruthy()
    expect(screen.queryByText('Ficheiros alterados')).toBeNull()
    expect(screen.queryByText('feat: applied by whx')).toBeNull()

    expect(screen.queryByRole('tab', { name: /Por publicar/ })).toBeNull()
    expect(await screen.findByText('Commits por publicar')).toBeTruthy()

    openTab('Histórico')
    expect(screen.getByText('feat: applied by whx')).toBeTruthy()
    expect(document.querySelector('.git-commit-graph')).toBeTruthy()
    expect(screen.getByText('WHX')).toBeTruthy()

    openTab('Branches')
    expect(screen.getAllByText('main').length).toBeGreaterThan(0)
    expect(screen.getAllByText('feature').length).toBeGreaterThan(0)
    const mergeSelect = screen.getByRole('combobox', { name: 'Branch a fazer merge' })
    expect(within(mergeSelect).getByRole('option', { name: 'origin/main' })).toBeTruthy()

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
    expect(screen.getByTestId('change-diff-editor').textContent).toContain('app.go')
  })

  it('manually commits selected worktree files even when auto-commit is enabled', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ commit_mode: 'auto', pending: [] }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar app.go' }))
    fireEvent.change(screen.getByPlaceholderText('ex.: fix(ui): ajustar painel Git'), { target: { value: 'fix(ui): ajustar painel Git' } })
    fireEvent.click(screen.getByRole('button', { name: /Commitar selecionados \(1\)/ }))

    await waitFor(() => expect(api.commitGitWorktree).toHaveBeenCalledWith('ses_1', 'fix(ui): ajustar painel Git', ['app.go']))
  })

  it('shows unpublished commits with details and publishes only the selected oldest prefix', async () => {
    const oldest = { sha: '1111111111111111111111111111111111111111', short_sha: '1111111', subject: 'feat: oldest unpublished', body: 'Old body', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-10T10:00:00Z', parents: ['0000000000000000000000000000000000000000'], request_id: 'req_1', plan_id: 'plan_1', wharnex: true, merge: false, pushed: false }
    const newest = { sha: '2222222222222222222222222222222222222222', short_sha: '2222222', subject: 'fix: newest unpublished', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-11T10:00:00Z', parents: [oldest.sha], request_id: 'req_2', plan_id: 'plan_2', wharnex: true, merge: false, pushed: false }
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ branches: overview().branches.map((branch) => branch.name === 'main' ? { ...branch, ahead: 2, commit_sha: newest.sha } : branch) }))
    vi.mocked(api.gitUnpushed).mockResolvedValue({ branch: 'main', upstream: 'origin/main', remote: 'origin', remote_branch: 'main', has_upstream: true, commits: [newest, oldest] })
    vi.mocked(api.gitUnpushedCommit).mockResolvedValue({ commit: newest, diff: 'diff --git a/new.ts b/new.ts\n+fixed' })

    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    expect(await screen.findByText('fix: newest unpublished')).toBeTruthy()
    expect(screen.getByText('feat: oldest unpublished')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar feat: oldest unpublished' }))
    fireEvent.click(screen.getByRole('button', { name: /Push selecionado \(1\)/ }))
    await waitFor(() => expect(api.gitPushSelected).toHaveBeenCalledWith('ses_1', [oldest.sha]))

    fireEvent.click(screen.getAllByRole('button', { name: /Ver alterações/ })[0])
    await waitFor(() => expect(api.gitUnpushedCommit).toHaveBeenCalledWith('ses_1', newest.sha))
    expect(await screen.findByRole('dialog', { name: 'Commit 2222222' })).toBeTruthy()
    expect(screen.getByText(/Request/)).toBeTruthy()
    expect(screen.getByTestId('change-diff-editor').textContent).toContain('new.ts')
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
    await screen.findByText('Ficheiros alterados')
    const tab = Array.from(screen.getByRole('tablist', { name: 'Secções do Git' }).querySelectorAll<HTMLButtonElement>('[role=tab]')).find((candidate) => candidate.textContent?.includes('Alterações'))
    expect(tab?.querySelector('.git-tab-count')?.textContent).toBe('3')
    expect(screen.queryByRole('tab', { name: /Por publicar/ })).toBeNull()

    expect(await screen.findByText('fix: local unpublished commit')).toBeTruthy()
    expect(screen.getByText(/Sem upstream, a lista abaixo mostra commits de HEAD/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Push selecionado/ })).toBeNull()
    expect((screen.getByRole('checkbox', { name: 'Selecionar fix: local unpublished commit' }) as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Push completo/ }))
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledWith('ses_1', 'origin', 'fix/no-upstream', true))
  })

  it('loads selected and all-branch commit timelines', async () => {
    vi.mocked(api.gitHistory).mockResolvedValue([{ sha: 'f1', short_sha: 'f1', subject: 'feat: feature timeline', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-11T10:00:00Z', parents: ['a2'], wharnex: false, merge: false, pushed: false }])
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
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

  it('shows visible processing and a terminal modal for commit and fetch actions', async () => {
    let finishCommit: ((value: { outcomes: Array<{ pending_id: string; subject: string; commit_sha: string }> }) => void) | undefined
    vi.mocked(api.commitGitPending).mockImplementationOnce(() => new Promise((resolve) => { finishCommit = resolve }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    fireEvent.click(await screen.findByRole('button', { name: /Commitar todos/ }))

    const commitDialog = await screen.findByRole('dialog', { name: 'A criar commits' })
    expect(commitDialog.textContent).toContain('A executar operação Git')
    expect(commitDialog.querySelector('.git-operation-spinner')).toBeTruthy()

    finishCommit?.({ outcomes: [{ pending_id: 'p1', subject: 'feat: one', commit_sha: 'abc' }] })
    await waitFor(() => expect(commitDialog.textContent).toContain('Operação concluída'))
    expect(commitDialog.textContent).toContain('1 commit(s) criado(s)')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    openTab('Branches')
    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }))
    const fetchDialog = await screen.findByRole('dialog', { name: 'A procurar alterações na origem' })
    await waitFor(() => expect(fetchDialog.textContent).toContain('Fetch de origin concluído'))
    expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin')
  })

  it('renders remote Git failures as high-contrast operational errors', async () => {
    vi.mocked(api.gitFetch).mockRejectedValueOnce(new Error('fetch origin: /usr/bin/gh: not found'))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openTab('Branches')

    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.classList.contains('error-card')).toBe(true)
    expect(alert.textContent).toContain('/usr/bin/gh: not found')
  })

  it('fetches, pulls and switches branches from version control', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openTab('Branches')

    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }))
    await waitFor(() => expect((screen.getByRole('button', { name: /Pull/ }) as HTMLButtonElement).disabled).toBe(false))
    expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin')

    fireEvent.click(screen.getByRole('button', { name: /Pull/ }))
    const featureRow = screen.getByText('feature', { selector: '.git-branch-name' }).closest('li')
    const featureSwitch = featureRow ? within(featureRow).getByRole('button', { name: 'Alternar' }) : null
    if (!featureSwitch) throw new Error('feature switch missing')
    await waitFor(() => expect((featureSwitch as HTMLButtonElement).disabled).toBe(false))
    expect(api.gitPull).toHaveBeenCalledWith('ses_1', 'origin', 'main')

    fireEvent.click(featureSwitch)
    await waitFor(() => expect(api.gitSwitch).toHaveBeenCalledWith('ses_1', 'feature'))
  })

  it('toggles the commit mode from settings', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openTab('Definições')
    fireEvent.click(screen.getByRole('button', { name: /Auto-commit/ }))
    await waitFor(() => expect(api.setGitCommitMode).toHaveBeenCalledWith('ses_1', 'auto'))
  })

  it('commits every pending record, or only the selected ones', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openChangesTab('Commits pendentes')
    fireEvent.click(await screen.findByRole('button', { name: /Commitar todos/ }))
    await waitFor(() => expect(api.commitGitPending).toHaveBeenCalledWith('ses_1', []))

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(screen.getByRole('button', { name: /Selecionados \(1\)/ }))
    await waitFor(() => expect(api.commitGitPending).toHaveBeenCalledWith('ses_1', ['p2']))
  })

  it('labels discarding as removing only the record', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openChangesTab('Commits pendentes')
    const discard = (await screen.findAllByRole('button', { name: /Descartar registo/ }))[0]
    expect(discard.getAttribute('title')).toContain('ficheiros ficam intactos')
    fireEvent.click(discard)
    await waitFor(() => expect(api.discardGitPending).toHaveBeenCalledWith('ses_1', ['p1']))
  })

  it('pushes the current branch and reports the outcome', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openTab('Branches')
    fireEvent.click(screen.getByRole('button', { name: /Push/ }))
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledWith('ses_1', 'origin', 'main', false))
    expect((await screen.findByRole('status')).textContent).toContain('Push concluído')
  })

  it('explains that a push conflict published nothing', async () => {
    vi.mocked(api.gitPush).mockResolvedValue({ outcome: 'conflict', remote: 'origin', branch: 'main', conflict_id: 'cf_1' })
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openTab('Branches')
    fireEvent.click(screen.getByRole('button', { name: /Push/ }))
    expect((await screen.findByRole('status')).textContent).toContain('Nada foi publicado')
  })

  it('merges the chosen branch', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openTab('Branches')
    const select = screen.getByRole('combobox', { name: 'Branch a fazer merge' })
    fireEvent.change(select, { target: { value: 'feature' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await waitFor(() => expect(api.gitMerge).toHaveBeenCalledWith('ses_1', 'feature'))
  })


  it('shows branch divergence and local/remote counterpart flags and can switch from a remote row', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openTab('Branches')
    expect(screen.getAllByTitle('1 commit(s) para enviar').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Existe remotamente como origin/main')).toBeTruthy()
    expect(screen.getByLabelText('Existe localmente como main')).toBeTruthy()
    const remoteRow = screen.getByText('origin/feature', { selector: '.git-branch-name' }).closest('li')
    const switchButton = remoteRow?.querySelector<HTMLButtonElement>('.git-branch-switch')
    if (!switchButton) throw new Error('remote switch missing')
    fireEvent.click(switchButton)
    await waitFor(() => expect(api.gitSwitch).toHaveBeenCalledWith('ses_1', 'origin/feature'))
  })

  it('merges selected remote branches into a remote target without changing the local checkout', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
    openTab('Branches')
    fireEvent.change(screen.getByRole('combobox', { name: 'Branch remota de destino' }), { target: { value: 'origin/main' } })
    const sources = screen.getByRole('listbox', { name: 'Branches remotas a integrar' }) as HTMLSelectElement
    const source = Array.from(sources.options).find((option) => option.value === 'origin/feature')
    if (!source) throw new Error('remote source missing')
    source.selected = true
    fireEvent.change(sources)
    fireEvent.click(screen.getByRole('button', { name: /Merge remoto \(1\)/ }))
    await waitFor(() => expect(api.gitRemoteMerge).toHaveBeenCalledWith('ses_1', 'origin/main', ['origin/feature']))
  })

  it('warns when the repository has no Git identity for manual commits', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ has_identity: false }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect((await screen.findByRole('button', { name: /Commitar selecionados/ })).hasAttribute('disabled')).toBe(true)
    openChangesTab('Commits pendentes')
    expect(screen.getByRole('button', { name: /Commitar todos/ }).hasAttribute('disabled')).toBe(true)
    openTab('Definições')
    expect(screen.getByText(/não tem/)).toBeTruthy()
  })

  it('locks the toggle when the project always commits', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ commit_mode: 'auto', commit_mode_fixed: true }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Ficheiros alterados')
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

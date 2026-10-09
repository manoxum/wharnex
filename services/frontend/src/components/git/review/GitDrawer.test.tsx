import { overview, session, openTab, openChangesTab, confirmGitReview } from './testing/fixtures'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { GitDrawer } from './GitDrawer'
describe('GitDrawer', () => {
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

  it('separates worktree files from unpublished commits while keeping Wharnex records available in settings', async () => {
    const unpublished = { ...overview().commits[0], subject: 'feat: unpublished local commit' }
    vi.mocked(api.gitUnpushed).mockResolvedValue({ branch: 'main', upstream: 'origin/main', remote: 'origin', remote_branch: 'main', has_upstream: true, commits: [unpublished] })

    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect(await screen.findByText('Alterações locais')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Alterações pendentes/ }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('app.go')).toBeTruthy()
    expect(screen.queryByText('feat: unpublished local commit')).toBeNull()
    expect(screen.queryByText('feat: one')).toBeNull()
    expect(screen.queryByText('Commits por publicar')).toBeNull()

    openChangesTab('Commits pendentes')
    expect(await screen.findByText('feat: unpublished local commit')).toBeTruthy()
    expect(screen.queryByText('Alterações locais')).toBeNull()
    expect(screen.queryByText('app.go')).toBeNull()
    expect(screen.queryByText('feat: one')).toBeNull()
    expect(screen.getByText('Commits por publicar')).toBeTruthy()

    openTab('Histórico')
    expect(await screen.findByText('feat: applied by whx')).toBeTruthy()
    const graph = document.querySelector('.git-commit-graph')
    const tail = document.querySelector('.git-history-tail')
    expect(graph).toBeTruthy()
    expect(graph?.querySelector('.git-commit-graph-lines')).toBeTruthy()
    expect(graph?.querySelector('.git-graph-node')).toBeTruthy()
    expect(tail?.querySelector('.git-commit-meta')?.textContent).toContain('a1')
    expect(tail?.querySelector('.git-line-stats')).toBeTruthy()
    expect(screen.getByText('WHX')).toBeTruthy()

    openTab('Branches')
    expect(screen.getAllByText('main').length).toBeGreaterThan(0)
    expect(screen.getAllByText('feature').length).toBeGreaterThan(0)
    const mergeSelect = screen.getByRole('combobox', { name: 'Branch a fazer merge' })
    expect(await within(mergeSelect).findByRole('option', { name: /origin\/main/ })).toBeTruthy()

    openTab('Definições')
    expect(screen.getByRole('group', { name: 'Modo de commit' })).toBeTruthy()
    expect(screen.getByText('https://github.com/org/repo.git')).toBeTruthy()
    expect(screen.getByText('Registos Wharnex por commitar')).toBeTruthy()
    expect(screen.getByText('feat: one')).toBeTruthy()
  })


  it('creates and safely removes local branches from the branch directory', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')

    fireEvent.change(screen.getByRole('textbox', { name: 'Nome da nova branch' }), { target: { value: 'feature/new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar branch' }))
    await waitFor(() => expect(api.gitCreateBranch).toHaveBeenCalledWith('ses_1', 'feature/new', 'main', ''))

    fireEvent.click(screen.getByRole('button', { name: 'Remover branch feature' }))
    await waitFor(() => expect(api.gitDeleteBranch).toHaveBeenCalledWith('ses_1', 'feature', ''))
  })

  it('lists tags and publishes a VERSION-based release from a remote branch modal', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')

    expect(screen.getByText('Tags e releases')).toBeTruthy()
    expect(screen.getByText('v1.2.96.0')).toBeTruthy()
    expect(screen.queryByText('Preparar uma nova release')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Nova release' }))

    const dialog = await screen.findByRole('dialog', { name: 'Criar nova release' })
    const publish = within(dialog).getByRole('button', { name: 'Criar tag e release' }) as HTMLButtonElement
    const branchSelect = within(dialog).getByRole('combobox', { name: 'Branch remota da release' })
    expect(within(branchSelect).queryByRole('option', { name: 'main' })).toBeNull()
    expect(within(branchSelect).getByRole('option', { name: 'origin/main' })).toBeTruthy()
    expect(within(branchSelect).getByRole('option', { name: 'origin/feature' })).toBeTruthy()
    expect(within(dialog).queryByRole('combobox', { name: 'Remoto da release' })).toBeNull()
    expect(within(dialog).getAllByText('v1.2.97.3').length).toBeGreaterThan(0)
    expect(publish.disabled).toBe(true)

    fireEvent.change(branchSelect, { target: { value: 'origin/main' } })
    const editor = within(dialog).getByRole('textbox', { name: 'Texto manual da release' })
    editor.innerHTML = '<strong>Release estável</strong>'
    fireEvent.input(editor)
    expect(publish.disabled).toBe(false)

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Tag opcional da release' }), { target: { value: 'rc1' } })
    expect(within(dialog).getAllByText('v1.2.97.3-rc1').length).toBeGreaterThan(0)
    fireEvent.click(publish)

    await waitFor(() => expect(api.gitCreateRelease).toHaveBeenCalledWith('ses_1', {
      branch: 'origin/main', tag_suffix: 'rc1', title: '', body: '<strong>Release estável</strong>',
    }))
  })

  it('allows an empty tag suffix and can delegate release-note writing to GPT for the remote branch', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')
    fireEvent.click(screen.getByRole('button', { name: 'Nova release' }))
    const dialog = await screen.findByRole('dialog', { name: 'Criar nova release' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Branch remota da release' }), { target: { value: 'origin/main' } })
    expect((within(dialog).getByRole('textbox', { name: 'Tag opcional da release' }) as HTMLInputElement).value).toBe('')
    expect(within(dialog).getAllByText('v1.2.97.3').length).toBeGreaterThan(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gerar com GPT' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Gerar notas da branch' }))
    await waitFor(() => expect(api.gitGenerateReleaseNotes).toHaveBeenCalledWith('ses_1', 'origin/main', ''))
    expect((await screen.findByRole('textbox', { name: 'Notas de release geradas pelo GPT' }) as HTMLTextAreaElement).value).toContain('Novidades')
  })

  it('opens worktree diffs with the changed-file sidebar and keeps the clicked file selected', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({
      commit_mode: 'auto', pending: [],
      working: { clean: false, stageable_count: 2, files: [
        { path: 'app.go', kind: 'change', status: 'modified', additions: 4, deletions: 1 },
        { path: 'new.ts', kind: 'change', status: 'added', additions: 8, deletions: 0 },
      ] },
    }))
    vi.mocked(api.gitFileDiff).mockImplementation(async (_id, path) => ({ path, diff: `diff --git a/${path} b/${path}\n+changed` }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect(await screen.findByText('Alterações locais')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir diff de app.go' }))
    await waitFor(() => expect(api.gitFileDiff).toHaveBeenCalledWith('ses_1', 'app.go', ''))

    const dialog = await screen.findByRole('dialog', { name: 'Diff de app.go' })
    const sidebar = within(dialog).getByRole('complementary', { name: 'Ficheiros alterados' })
    expect(within(sidebar).getByRole('button', { name: 'Abrir app.go no diff do worktree' }).className).toContain('active')
    expect(within(sidebar).getByRole('button', { name: 'Abrir new.ts no diff do worktree' })).toBeTruthy()
    expect(screen.getByTestId('change-diff-editor').textContent).toContain('app.go')

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Abrir new.ts no diff do worktree' }))
    await waitFor(() => expect(api.gitFileDiff).toHaveBeenCalledWith('ses_1', 'new.ts', ''))
    await waitFor(() => expect(screen.getByTestId('change-diff-editor').textContent).toContain('new.ts'))
  })

  it('manually commits selected worktree files even when auto-commit is enabled', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ commit_mode: 'auto', pending: [] }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar app.go' }))
    fireEvent.change(screen.getByPlaceholderText('ex.: fix(ui): ajustar painel Git'), { target: { value: 'fix(ui): ajustar painel Git' } })
    fireEvent.click(screen.getByRole('button', { name: /Commitar \(1\)/ }))
    await confirmGitReview()

    await waitFor(() => expect(api.commitGitWorktree).toHaveBeenCalledWith('ses_1', 'fix(ui): ajustar painel Git', ['app.go'], ''))
  })

  it('shows unpublished commits with details and publishes only the selected oldest prefix', async () => {
    const oldest = { sha: '1111111111111111111111111111111111111111', short_sha: '1111111', subject: 'feat: oldest unpublished', body: 'Old body', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-10T10:00:00Z', parents: ['0000000000000000000000000000000000000000'], request_id: 'req_1', plan_id: 'plan_1', wharnex: true, merge: false, pushed: false }
    const newest = { sha: '2222222222222222222222222222222222222222', short_sha: '2222222', subject: 'fix: newest unpublished', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-11T10:00:00Z', parents: [oldest.sha], request_id: 'req_2', plan_id: 'plan_2', wharnex: true, merge: false, pushed: false }
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ branches: overview().branches.map((branch) => branch.name === 'main' ? { ...branch, ahead: 2, commit_sha: newest.sha } : branch) }))
    vi.mocked(api.gitUnpushed).mockResolvedValue({ branch: 'main', upstream: 'origin/main', remote: 'origin', remote_branch: 'main', has_upstream: true, commits: [newest, oldest] })
    vi.mocked(api.gitUnpushedCommit).mockResolvedValue({ commit: newest, diff: 'diff --git a/new.ts b/new.ts\n+fixed' })

    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openChangesTab('Commits pendentes')
    expect(await screen.findByText('fix: newest unpublished')).toBeTruthy()
    expect(screen.getByText('feat: oldest unpublished')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar feat: oldest unpublished' }))
    fireEvent.click(screen.getByRole('button', { name: /Push selecionado \(1\)/ }))
    await confirmGitReview()
    await waitFor(() => expect(api.gitPushSelected).toHaveBeenCalledWith('ses_1', [oldest.sha], ''))

    fireEvent.click(screen.getByRole('button', { name: 'Abrir diff do commit 2222222' }))
    await waitFor(() => expect(api.gitUnpushedCommit).toHaveBeenCalledWith('ses_1', newest.sha, ''))
    expect(await screen.findByRole('dialog', { name: 'Commit 2222222' })).toBeTruthy()
    expect(screen.getByText(/Request/)).toBeTruthy()
    expect(screen.getByTestId('change-diff-editor').textContent).toContain('new.ts')
  })



  it('loads selected and all-branch commit timelines', async () => {
    vi.mocked(api.gitHistoryPage).mockResolvedValue({ commits: [{ sha: 'f1', short_sha: 'f1', subject: 'feat: feature timeline', author_name: 'Dev', author_email: 'dev@x', committed_at: '2026-09-11T10:00:00Z', parents: ['a2'], wharnex: false, merge: false, pushed: false }], next_offset: 1, has_more: false })
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Histórico')

    const branchSelect = screen.getByRole('listbox', { name: 'Branches do histórico' }) as HTMLSelectElement
    const featureOption = screen.getByRole('option', { name: 'feature' }) as HTMLOptionElement
    featureOption.selected = true
    fireEvent.change(branchSelect)
    await waitFor(() => expect(api.gitHistoryPage).toHaveBeenCalledWith('ses_1', ['feature'], false, 0, 50, ''))
    expect(await screen.findByText('feat: feature timeline')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Todas' }))
    await waitFor(() => expect(api.gitHistoryPage).toHaveBeenCalledWith('ses_1', [], true, 0, 50, ''))
  })

  it('shows contributor ranking and weekly Git activity like repository insights', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Contribuidores')

    expect(await screen.findByText('Ranking')).toBeTruthy()
    await waitFor(() => expect(api.gitContributors).toHaveBeenCalledWith('ses_1', ''))
    expect(screen.getByText('Ana Costa')).toBeTruthy()
    expect(screen.getByText('Bruno Lima')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Commits por semana em 2 semanas' })).toBeTruthy()
    expect(screen.getByRole('img', { name: /Calendário de contribuições de/ })).toBeTruthy()
    const ranking = document.querySelector('.git-contributor-ranking')
    expect(ranking?.textContent).toContain('Ana Costa')
    expect(ranking?.textContent).toContain('32')
    expect(document.querySelectorAll('.git-contribution-day').length).toBe(371)
    expect(document.querySelectorAll('.git-contributor-area-chart').length).toBe(2)
  })

  it('presents branch history commit details with a dedicated visual hierarchy', async () => {
    const commit = { ...overview().commits[0], body: 'Improve the branch history diff review.', request_id: 'req_history_1', plan_id: 'plan_history_1', additions: 12, deletions: 3, files_changed: 2 }
    vi.mocked(api.gitHistoryPage).mockResolvedValue({ commits: [commit], next_offset: 1, has_more: false })
    vi.mocked(api.gitHistoryCommit).mockResolvedValue({ commit, diff: 'diff --git a/app.go b/app.go\n--- a/app.go\n+++ b/app.go\n@@ -1 +1 @@\n-old\n+new' })

    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Histórico')
    fireEvent.click(await screen.findByRole('button', { name: /feat: applied by whx/ }))

    const dialog = await screen.findByRole('dialog', { name: 'Commit a1' })
    expect(dialog.classList.contains('git-history-commit-modal')).toBe(true)
    expect(dialog.querySelector('.git-history-commit-header')?.textContent).toContain('Dev')
    expect(dialog.querySelector('.git-history-commit-eyebrow')?.textContent).toContain('a1')
    expect(dialog.querySelector('.git-history-commit-stats')?.textContent).toContain('+12adições')
    expect(dialog.querySelector('.git-history-commit-stats')?.textContent).toContain('−3remoções')
    expect(dialog.querySelector('.git-history-commit-actions')?.textContent).toContain('2ficheiro(s)')
    expect(dialog.querySelector('.git-history-commit-disclosure')?.textContent).toContain('req_history_1')
    expect(dialog.querySelector('.git-history-commit-disclosure')?.textContent).toContain('plan_history_1')
    expect(screen.getByTestId('change-diff-editor').textContent).toContain('app.go')
  })

  it('shows visible processing and a terminal modal for commit and fetch actions', async () => {
    let finishCommit: ((value: { outcomes: Array<{ pending_id: string; subject: string; commit_sha: string }> }) => void) | undefined
    vi.mocked(api.commitGitPending).mockImplementationOnce(() => new Promise((resolve) => { finishCommit = resolve }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Definições')
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
    expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin', '')
  })

  it('renders remote Git failures as high-contrast operational errors', async () => {
    vi.mocked(api.gitFetch).mockRejectedValueOnce(new Error('fetch origin: /usr/bin/gh: not found'))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')

    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.classList.contains('error-card')).toBe(true)
    expect(alert.textContent).toContain('/usr/bin/gh: not found')
  })

  it('fetches, pulls and switches branches from version control', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')

    fireEvent.click(screen.getByRole('button', { name: /Fetch/ }))
    await waitFor(() => expect((screen.getByRole('button', { name: /Pull/ }) as HTMLButtonElement).disabled).toBe(false))
    expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin', '')

    fireEvent.click(screen.getByRole('button', { name: /Pull/ }))
    await confirmGitReview()
    const featureRow = screen.getByText('feature', { selector: '.git-branch-name' }).closest('li')
    if (!featureRow) throw new Error('feature row missing')
    const featureSwitch = within(featureRow).getByRole('button', { name: 'Alternar para feature' })
    expect(featureSwitch.textContent).toBe('')
    expect(within(featureRow).getByRole('button', { name: 'Remover branch feature' }).textContent).toBe('')
    await waitFor(() => expect((featureSwitch as HTMLButtonElement).disabled).toBe(false))
    expect(api.gitPull).toHaveBeenCalledWith('ses_1', 'origin', 'main', '')

    fireEvent.click(featureSwitch)
    await waitFor(() => expect(api.gitSwitch).toHaveBeenCalledWith('ses_1', 'feature', ''))
  })

  it('copies branch names and remote URLs from version control', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')

    openTab('Branches')
    fireEvent.click(screen.getByRole('button', { name: 'Copiar nome da branch main' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('main'))
    const featureRow = screen.getByText('feature', { selector: '.git-branch-name' }).closest('li')
    if (!featureRow) throw new Error('feature row missing')
    fireEvent.click(within(featureRow).getByRole('button', { name: 'Copiar nome da branch feature' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('feature'))

    openTab('Definições')
    fireEvent.click(screen.getByRole('button', { name: 'Copiar URL de origin' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://github.com/org/repo.git'))
  })

  it('toggles the commit mode from settings', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Definições')
    fireEvent.click(screen.getByRole('button', { name: /Auto-commit/ }))
    await waitFor(() => expect(api.setGitCommitMode).toHaveBeenCalledWith('ses_1', 'auto'))
  })

  it('commits every pending record, or only the selected ones', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Definições')
    fireEvent.click(await screen.findByRole('button', { name: /Commitar todos/ }))
    await waitFor(() => expect(api.commitGitPending).toHaveBeenCalledWith('ses_1', []))

    fireEvent.click(screen.getAllByRole('checkbox')[1])
    fireEvent.click(screen.getByRole('button', { name: /Selecionados \(1\)/ }))
    await waitFor(() => expect(api.commitGitPending).toHaveBeenCalledWith('ses_1', ['p2']))
  })

  it('labels discarding as removing only the record', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Definições')
    const discard = (await screen.findAllByRole('button', { name: /Descartar registo/ }))[0]
    expect(discard.getAttribute('title')).toContain('ficheiros ficam intactos')
    fireEvent.click(discard)
    await waitFor(() => expect(api.discardGitPending).toHaveBeenCalledWith('ses_1', ['p1']))
  })

  it('pushes the current branch and reports the outcome', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')
    fireEvent.click(screen.getByRole('button', { name: /Push/ }))
    await confirmGitReview()
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledWith('ses_1', 'origin', 'main', false, ''))
    expect((await screen.findByRole('status')).textContent).toContain('Push concluído')
  })

  it('explains that a push conflict published nothing', async () => {
    vi.mocked(api.gitPush).mockResolvedValue({ outcome: 'conflict', remote: 'origin', branch: 'main', conflict_id: 'cf_1' })
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')
    fireEvent.click(screen.getByRole('button', { name: /Push/ }))
    await confirmGitReview()
    expect((await screen.findByRole('status')).textContent).toContain('Nada foi publicado')
  })

  it('merges the chosen branch', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')
    const select = screen.getByRole('combobox', { name: 'Branch a fazer merge' })
    await waitFor(() => expect(Array.from((select as HTMLSelectElement).options).some((option) => option.value === 'feature')).toBe(true))
    fireEvent.change(select, { target: { value: 'feature' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))
    await confirmGitReview()
    await waitFor(() => expect(api.gitMerge).toHaveBeenCalledWith('ses_1', 'feature', ''))
  })


  it('shows branch divergence and local/remote counterpart flags and can switch from a remote row', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')
    expect(screen.getAllByTitle('1 commit(s) para enviar').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Existe remotamente como origin/main')).toBeTruthy()
    expect(screen.getByLabelText('Existe localmente como main')).toBeTruthy()
    const remoteRow = screen.getByText('origin/feature', { selector: '.git-branch-name' }).closest('li')
    const switchButton = remoteRow?.querySelector<HTMLButtonElement>('.git-branch-switch')
    if (!switchButton) throw new Error('remote switch missing')
    fireEvent.click(switchButton)
    await waitFor(() => expect(api.gitSwitch).toHaveBeenCalledWith('ses_1', 'origin/feature', ''))
  })

  it('merges selected remote branches into a remote target without changing the local checkout', async () => {
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
    openTab('Branches')
    fireEvent.change(screen.getByRole('combobox', { name: 'Branch remota de destino' }), { target: { value: 'origin/main' } })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Integrar origin/feature' }))
    fireEvent.click(screen.getByRole('button', { name: /Merge remoto \(1\)/ }))
    await confirmGitReview()
    await waitFor(() => expect(api.gitRemoteMerge).toHaveBeenCalledWith('ses_1', 'origin/main', ['origin/feature'], ''))
  })

  it('lists superproject and submodules together and selects targets per operation', async () => {
    const repositories = [
      { path: '', label: 'superproject', depth: 0, root: true, initialized: true, available: true, current_branch: 'main', detached: false, commit_sha: 'a1' },
      { path: 'services/core', label: 'services/core', depth: 1, root: false, initialized: true, available: true, current_branch: 'main', detached: false, commit_sha: 'b1' },
    ]
    vi.mocked(api.gitOverview).mockImplementation(async (_id, repository = '') => overview({ repository, repositories }))

    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Repositórios do projeto')
    expect(screen.queryByLabelText('Repositório ativo')).toBeNull()
    expect(screen.getByText('services/core')).toBeTruthy()
    openTab('Branches')
    fireEvent.click(await screen.findByRole('button', { name: 'Fetch de origin' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Executar em services/core' }))
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }))
    await waitFor(() => expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin', ''))
    expect(api.gitFetch).not.toHaveBeenCalledWith('ses_1', 'origin', 'services/core')
  })

  it('warns when the repository has no Git identity for manual commits', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ has_identity: false }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    expect((await screen.findByRole('button', { name: /Commitar \(0\)/ })).hasAttribute('disabled')).toBe(true)
    openTab('Definições')
    expect(screen.getByRole('button', { name: /Commitar todos/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/não tem/)).toBeTruthy()
  })

  it('locks the toggle when the project always commits', async () => {
    vi.mocked(api.gitOverview).mockResolvedValue(overview({ commit_mode: 'auto', commit_mode_fixed: true }))
    render(<GitDrawer session={session} busy={false} onClose={vi.fn()}/>)
    await screen.findByText('Alterações locais')
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

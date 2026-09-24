import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitOverview } from '../types'
import { api } from '../lib/api'
import { announceHeaderPopover } from '../lib/headerPopover'
import { ProjectGitBadge } from './ProjectGitBadge'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      gitOverview: vi.fn(),
      gitHead: vi.fn(),
      gitFetch: vi.fn(),
      gitPull: vi.fn(),
      gitPush: vi.fn(),
      gitPreview: vi.fn(),
      commitGitWorktree: vi.fn(),
      gitSwitch: vi.fn(),
      getSession: vi.fn(),
    },
  }
})

function overview(): GitOverview {
  return {
    project_path: '/w/alpha', project_version: 'v1.2.64.0', available: true, commit_mode: 'auto', detached: false, has_identity: true,
    repository: '', repositories: [],
    current_branch: 'main',
    branches: [
      { name: 'main', current: true, commit_sha: 'a1', subject: 'feat: current', upstream: 'origin/main', ahead: 1, behind: 0, has_upstream: true, gone: false, counterpart: 'origin/main', has_counterpart: true },
      { name: 'feature', current: false, commit_sha: 'b2', subject: 'feat: branch', ahead: 0, behind: 2, has_upstream: false, gone: false },
      { name: 'origin/main', remote: 'origin', current: false, commit_sha: 'a0', subject: 'feat: remote', ahead: 0, behind: 1, has_upstream: false, gone: false, counterpart: 'main', has_counterpart: true },
    ],
    remotes: [{ name: 'origin', url: 'https://github.com/org/repo.git' }],
    tags: [], commits: [], pending: [], working: { clean: true, stageable_count: 0, files: [] },
  }
}

function overviewWith(patch: Partial<GitOverview>): GitOverview {
  return { ...overview(), ...patch }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function openBadge() {
  fireEvent.click(await screen.findByRole('button', { name: 'Git: main, projeto v1.2.64.0' }))
  expect(await screen.findByRole('region', { name: 'Operações da branch atual' })).toBeTruthy()
}

describe('ProjectGitBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.gitOverview).mockResolvedValue(overview())
    vi.mocked(api.gitHead).mockResolvedValue({ current_branch: 'main', detached: false, commit_sha: 'a1' })
    vi.mocked(api.gitPreview).mockResolvedValue({ operation: 'push', repository: '', from_label: 'origin/main', to_label: 'main', diff: 'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n' })
    vi.mocked(api.commitGitWorktree).mockResolvedValue({ commit_sha: 'cafe1234cafe', paths: ['app.ts'] })
  })

  it('refreshes remote refs every minute without opening the popup', async () => {
    vi.useFakeTimers()
    vi.mocked(api.gitFetch).mockResolvedValue({ outcome: 'fetched', remote: 'origin' })
    const view = render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)
    try {
      await act(async () => { await Promise.resolve() })
      await act(async () => {
        vi.advanceTimersByTime(60_000)
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin', '')
      expect(vi.mocked(api.gitOverview).mock.calls.length).toBeGreaterThanOrEqual(3)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('shows every repository and chooses operation targets in the execution modal', async () => {
    const repositories = [
      { path: '', label: 'superproject', depth: 0, root: true, initialized: true, available: true, current_branch: 'main', detached: false, commit_sha: 'a1' },
      { path: 'packages/api', label: 'packages/api', depth: 1, root: false, initialized: true, available: true, current_branch: 'develop', detached: false, commit_sha: 'b1' },
    ]
    vi.mocked(api.gitOverview).mockImplementation(async (_id, repository = '') => repository === 'packages/api'
      ? overviewWith({ repository, repositories, current_branch: 'develop', branches: [{ name: 'develop', current: true, commit_sha: 'b1', upstream: 'origin/develop', ahead: 2, behind: 1, has_upstream: true, gone: false }] })
      : overviewWith({ repository, repositories }))
    vi.mocked(api.gitFetch).mockResolvedValue({ outcome: 'fetched', remote: 'origin' })

    render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)
    await openBadge()
    expect(screen.queryByLabelText('Repositório')).toBeNull()
    expect(screen.getByText('Superprojeto')).toBeTruthy()
    expect(screen.getByText('packages/api')).toBeTruthy()
    expect(screen.getByText('origin/develop')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    const rootTarget = await screen.findByRole('checkbox', { name: 'Executar em Superprojeto' })
    fireEvent.click(rootTarget)
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }))
    await waitFor(() => expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin', 'packages/api'))
    expect(api.gitFetch).not.toHaveBeenCalledWith('ses_1', 'origin', '')
  })

  it('dismisses the branch popup on outside interaction even when bubbling is stopped', async () => {
    render(<div>
      <button type="button" data-testid="outside" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>Outside</button>
      <ProjectGitBadge sessionID="ses_1" busy={false}/>
    </div>)
    const outside = screen.getByTestId('outside')

    await openBadge()
    fireEvent.pointerDown(outside)
    expect(screen.queryByRole('region', { name: 'Operações da branch atual' })).toBeNull()

    await openBadge()
    fireEvent.keyDown(outside, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Operações da branch atual' })).toBeNull()
  })

  it('dismisses the branch popup when focus leaves the control or the window blurs', async () => {
    render(<div>
      <button type="button" data-testid="focus-target">Outside</button>
      <ProjectGitBadge sessionID="ses_1" busy={false}/>
    </div>)
    const outside = screen.getByTestId('focus-target')

    await openBadge()
    fireEvent.focusIn(outside)
    expect(screen.queryByRole('region', { name: 'Operações da branch atual' })).toBeNull()

    await openBadge()
    fireEvent(window, new Event('blur'))
    expect(screen.queryByRole('region', { name: 'Operações da branch atual' })).toBeNull()
  })

  it('Escape closes the whole branch popup even when the branch picker is open', async () => {
    render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)
    await openBadge()

    const picker = document.querySelector<HTMLButtonElement>('.project-git-picker-trigger')
    if (!picker) throw new Error('branch picker missing')
    fireEvent.click(picker)
    expect(await screen.findByRole('menu', { name: 'Branches disponíveis' })).toBeTruthy()

    fireEvent.keyDown(picker, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Branches disponíveis' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Operações da branch atual' })).toBeNull()
  })

  it('closes when another header popover is opened', async () => {
    render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)
    await openBadge()
    act(() => announceHeaderPopover('appearance'))
    expect(screen.queryByRole('region', { name: 'Operações da branch atual' })).toBeNull()
  })

  it('distinguishes worktree changes, pending commits and outgoing commits in the header', async () => {
    const state = overview()
    state.working = { clean: false, stageable_count: 1, files: [{ path: 'src/App.tsx', kind: 'change', status: 'modified', additions: 2, deletions: 1 }] }
    state.pending = [{ id: 'pending_1', project_path: '/w/alpha', subject: 'feat: pending', message: 'feat: pending', paths: ['src/App.tsx'], created_at: '2026-09-21T08:00:00Z' }]
    state.branches[0].ahead = 2
    vi.mocked(api.gitOverview).mockResolvedValue(state)

    render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)

    const indicators = await screen.findByLabelText('1 alteração sem commit · 1 commit pendente · 2 commits por enviar')
    expect(indicators.querySelector('.working')).toBeTruthy()
    expect(indicators.querySelector('.pending')).toBeTruthy()
    expect(indicators.querySelector('.outgoing')).toBeTruthy()
    const badge = screen.getByRole('button', { name: 'Git: main, projeto v1.2.64.0' })
    expect(badge.className).toContain('has-working')
    expect(badge.className).toContain('has-pending-commit')
    expect(badge.className).toContain('has-outgoing')
  })

  it('presents branch identity and upstream state as a compact Git summary', async () => {
    render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)
    await openBadge()

    expect(screen.getByText('Git do projeto')).toBeTruthy()
    expect(screen.getByText('Ligada ao remoto')).toBeTruthy()
    expect(screen.getByText('origin/main')).toBeTruthy()
    expect(screen.getByLabelText('1 para enviar e 0 para receber')).toBeTruthy()
  })

  it('uses a rich branch picker with local/remote sync details and copy actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)
    await openBadge()

    const picker = document.querySelector<HTMLButtonElement>('.project-git-picker-trigger')
    if (!picker) throw new Error('branch picker missing')
    fireEvent.click(picker)
    const menu = await screen.findByRole('menu', { name: 'Branches disponíveis' })
    expect(within(menu).getByText('Locais')).toBeTruthy()
    expect(within(menu).getByText('Remotas')).toBeTruthy()
    expect(within(menu).getByTitle('1 commit(s) para enviar')).toBeTruthy()
    expect(within(menu).getByTitle('2 commit(s) para receber')).toBeTruthy()

    fireEvent.click(within(menu).getByRole('button', { name: 'Copiar nome da branch feature' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('feature'))
    fireEvent.click(within(menu).getByRole('menuitem', { name: /feature/ }))
    expect(screen.queryByRole('menu', { name: 'Branches disponíveis' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Alternar' }).hasAttribute('disabled')).toBe(false)
  })

  it('shows the Git operation modal for fetch, pull and push from the branch popup', async () => {
    const fetch = deferred<Awaited<ReturnType<typeof api.gitFetch>>>()
    const pull = deferred<Awaited<ReturnType<typeof api.gitPull>>>()
    const push = deferred<Awaited<ReturnType<typeof api.gitPush>>>()
    vi.mocked(api.gitFetch).mockReturnValue(fetch.promise)
    vi.mocked(api.gitPull).mockReturnValue(pull.promise)
    vi.mocked(api.gitPush).mockReturnValue(push.promise)

    render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)
    await openBadge()

    fireEvent.click(screen.getByRole('button', { name: 'Fetch' }))
    const fetchDialog = await screen.findByRole('dialog', { name: 'A procurar alterações na origem' })
    expect(fetchDialog.className).toContain('running')
    expect(fetchDialog.querySelector('.git-operation-message')?.textContent).toBe('A executar operação Git…')
    expect(document.body.querySelector('.project-git-operation-layer')).toBeTruthy()
    expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin', '')
    fetch.resolve({ outcome: 'fetched', remote: 'origin' })
    await waitFor(() => expect(fetchDialog.className).toContain('success'))
    expect(fetchDialog.querySelector('.git-operation-message')?.textContent).toBe('Fetch de origin concluído.')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    const pullDialog = await screen.findByRole('dialog', { name: 'A integrar alterações da origem' })
    expect(pullDialog.className).toContain('running')
    expect(api.gitPull).toHaveBeenCalledWith('ses_1', 'origin', 'main', '')
    pull.resolve({ outcome: 'merged', remote: 'origin', branch: 'main', ref: 'origin/main' })
    await waitFor(() => expect(pullDialog.className).toContain('success'))
    expect(pullDialog.querySelector('.git-operation-message')?.textContent).toBe('Pull: merged.')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    const reviewDialog = await screen.findByRole('dialog', { name: 'A publicar alterações' })
    expect(reviewDialog.textContent).toContain('Revisão antes de executar')
    expect(api.gitPreview).toHaveBeenCalledWith('ses_1', { operation: 'push', repository: '', remote: 'origin', branch: 'main' })
    expect(api.gitPush).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: 'Confirmar e continuar' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledWith('ses_1', 'origin', 'main', false, ''))
    push.resolve({ outcome: 'pushed', remote: 'origin', branch: 'main' })
    await waitFor(() => expect((screen.getByRole('dialog', { name: 'A publicar alterações' })).className).toContain('success'))
    const pushDialog = screen.getByRole('dialog', { name: 'A publicar alterações' })
    expect(pushDialog.querySelector('.git-operation-message')?.textContent).toBe('Push: pushed.')
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy()
  })

  it('quick-commits all selected worktree changes and recalculates the push diff before publishing', async () => {
    const state = overview()
    state.working = { clean: false, stageable_count: 1, files: [{ path: 'app.ts', kind: 'change', status: 'modified' }] }
    vi.mocked(api.gitOverview).mockResolvedValue(state)
    vi.mocked(api.gitPreview)
      .mockResolvedValueOnce({ operation: 'push', repository: '', from_label: 'origin/main', to_label: 'main', diff: 'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+before-commit\n' })
      .mockResolvedValueOnce({ operation: 'push', repository: '', from_label: 'origin/main', to_label: 'main', diff: 'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+after-commit\n' })
    vi.mocked(api.gitPush).mockResolvedValue({ outcome: 'pushed', remote: 'origin', branch: 'main' })

    render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)
    await openBadge()
    fireEvent.click(screen.getByRole('button', { name: 'Push' }))

    const quickCommitInput = await screen.findByRole('textbox', { name: 'Mensagem do commit rápido' })
    fireEvent.change(quickCommitInput, { target: { value: 'fix(git): guardar alterações' } })
    fireEvent.click(screen.getByRole('button', { name: 'Commit rápido' }))

    await waitFor(() => expect(api.commitGitWorktree).toHaveBeenCalledWith('ses_1', 'fix(git): guardar alterações', [], '', true))
    await waitFor(() => expect(api.gitPreview).toHaveBeenCalledTimes(2))
    expect((await screen.findByRole('status')).textContent).toContain('diff do push foi recalculado')
    expect(api.gitPush).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Mensagem do commit rápido' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e continuar' }))
    await waitFor(() => expect(api.gitPush).toHaveBeenCalledWith('ses_1', 'origin', 'main', false, ''))
  })
})

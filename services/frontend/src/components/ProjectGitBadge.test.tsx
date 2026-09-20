import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitOverview } from '../types'
import { api } from '../lib/api'
import { ProjectGitBadge } from './ProjectGitBadge'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    api: {
      ...actual.api,
      gitOverview: vi.fn(),
      gitFetch: vi.fn(),
      gitPull: vi.fn(),
      gitPush: vi.fn(),
      gitSwitch: vi.fn(),
      getSession: vi.fn(),
    },
  }
})

function overview(): GitOverview {
  return {
    project_path: '/w/alpha', project_version: 'v1.2.64.0', available: true, commit_mode: 'auto', detached: false, has_identity: true,
    current_branch: 'main',
    branches: [{ name: 'main', current: true, commit_sha: 'a1', subject: 'feat: current', upstream: 'origin/main', ahead: 0, behind: 0, has_upstream: true, gone: false }],
    remotes: [{ name: 'origin', url: 'https://github.com/org/repo.git' }],
    commits: [], pending: [], working: { clean: true, stageable_count: 0, files: [] },
  }
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
      expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin')
      expect(vi.mocked(api.gitOverview).mock.calls.length).toBeGreaterThanOrEqual(3)
    } finally {
      view.unmount()
      vi.useRealTimers()
    }
  })

  it('dismisses the branch popup when the user clicks outside or presses Escape', async () => {
    render(<ProjectGitBadge sessionID="ses_1" busy={false}/>)
    await openBadge()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('region', { name: 'Operações da branch atual' })).toBeNull()

    await openBadge()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Operações da branch atual' })).toBeNull()
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
    expect(api.gitFetch).toHaveBeenCalledWith('ses_1', 'origin')
    fetch.resolve({ outcome: 'fetched', remote: 'origin' })
    await waitFor(() => expect(fetchDialog.className).toContain('success'))
    expect(fetchDialog.querySelector('.git-operation-message')?.textContent).toBe('Fetch de origin concluído.')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Pull' }))
    const pullDialog = await screen.findByRole('dialog', { name: 'A integrar alterações da origem' })
    expect(pullDialog.className).toContain('running')
    expect(api.gitPull).toHaveBeenCalledWith('ses_1', 'origin', 'main')
    pull.resolve({ outcome: 'merged', remote: 'origin', branch: 'main', ref: 'origin/main' })
    await waitFor(() => expect(pullDialog.className).toContain('success'))
    expect(pullDialog.querySelector('.git-operation-message')?.textContent).toBe('Pull: merged.')
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Push' }))
    const pushDialog = await screen.findByRole('dialog', { name: 'A publicar alterações' })
    expect(pushDialog.className).toContain('running')
    expect(api.gitPush).toHaveBeenCalledWith('ses_1', 'origin', 'main', false)
    push.resolve({ outcome: 'pushed', remote: 'origin', branch: 'main' })
    await waitFor(() => expect(pushDialog.className).toContain('success'))
    expect(pushDialog.querySelector('.git-operation-message')?.textContent).toBe('Push: pushed.')
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeTruthy()
  })
})

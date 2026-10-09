import { session, overview } from '../review/testing/fixtures'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../lib/transport/http/api'
import { useGitOperationFlow } from '../../../lib/git/workflow/useGitOperationFlow'
import { states, setupGitChangesScenario } from '../review/changes/testing'
import { useGitPublication } from './useGitPublication'

beforeEach(setupGitChangesScenario)

function renderPublication() {
  return renderHook(() => {
    const loadOverview = () => api.gitOverview(session.id)
    const flow = useGitOperationFlow({ sessionId: session.id, availableEntries: [], repositoryTargets: [], loadOverview, report: vi.fn(), setWorking: vi.fn(), setNotice: vi.fn(), setNoticeError: vi.fn() })
    return { flow, ...useGitPublication({ sessionId: session.id, flow, loadOverview }) }
  })
}

describe('complete project publication', () => {
  it('reviews the refreshed full inventory and publishes nested children before parents with one confirmation', async () => {
    const { result } = renderPublication()
    // Add a nested repository after render to prove the action reloads inventory.
    states.get('')!.repositories.push({ ...states.get('')!.repositories[1], path: 'module/nested', label: 'Nested', depth: 2 })
    states.set('module/nested', overview({ repository: 'module/nested', current_branch: 'release', branches: [{ ...overview().branches[0], name: 'release', upstream: 'team/release' }], remotes: [{ name: 'team', url: 'https://example.com/team.git' }] }))
    await act(() => result.current.pushProject())
    expect(result.current.flow.operation?.phase).toBe('reviewing')
    expect(result.current.flow.operation?.previews?.map((preview) => preview.repository)).toEqual(['module/nested', 'clean', 'module', ''])
    expect(api.gitPush).not.toHaveBeenCalled()
    expect(api.commitGitWorktree).not.toHaveBeenCalled()
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('success'))
    expect(vi.mocked(api.gitPush).mock.calls).toEqual([
      [session.id, 'team', 'release', false, 'module/nested'],
      [session.id, 'origin', 'main', false, 'clean'],
      [session.id, 'origin', 'main', false, 'module'],
      [session.id, 'origin', 'main', false, ''],
    ])
    expect(api.commitGitWorktree).not.toHaveBeenCalled()
    expect(result.current.flow.operation?.message).toContain('Nested: enviado')
    expect(result.current.flow.operation?.message).toContain('Superprojeto: enviado')
  })

  it('publishes a branch without upstream and reports already synchronized repositories', async () => {
    states.get('module')!.branches[0].has_upstream = false
    states.get('module')!.branches[0].upstream = undefined
    vi.mocked(api.gitPush).mockResolvedValue({ outcome: 'up_to_date', remote: 'origin', branch: 'main' })
    const { result } = renderPublication()
    await act(() => result.current.pushProject())
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('success'))
    expect(api.gitPush).toHaveBeenCalledWith(session.id, 'origin', 'main', true, 'module')
    expect(result.current.flow.operation?.message).toContain('clean: já atualizado')
    expect(result.current.flow.operation?.message).toContain('Superprojeto: já atualizado')
  })

  it.each(['unavailable', 'detached', 'remote', 'conflict'] as const)('blocks all pushes when a repository becomes %s', async (kind) => {
    const { result } = renderPublication()
    const state = states.get('clean')!
    if (kind === 'unavailable') states.get('')!.repositories.find((entry) => entry.path === 'clean')!.available = false
    if (kind === 'detached') state.detached = true
    if (kind === 'remote') state.remotes = []
    if (kind === 'conflict') state.in_progress = 'merge'
    await act(() => result.current.pushProject())
    expect(result.current.flow.operation?.phase).toBe('error')
    expect(result.current.flow.operation?.message).toContain('clean:')
    expect(api.gitPreview).not.toHaveBeenCalled()
    expect(api.gitPush).not.toHaveBeenCalled()
  })

  it('names a failed preview and publishes nothing', async () => {
    vi.mocked(api.gitPreview).mockRejectedValueOnce(new Error('Autenticação necessária'))
    const { result } = renderPublication()
    await act(() => result.current.pushProject())
    expect(result.current.flow.operation?.phase).toBe('error')
    expect(result.current.flow.operation?.message).toContain('clean: Autenticação necessária')
    expect(api.gitPush).not.toHaveBeenCalled()
  })

  it('retains completed results and stops before parents when a child fails', async () => {
    vi.mocked(api.gitPush)
      .mockResolvedValueOnce({ outcome: 'up_to_date', remote: 'origin', branch: 'main' })
      .mockResolvedValueOnce({ outcome: 'auth_required', remote: 'origin', branch: 'main', detail: 'Autenticação necessária' })
    const { result } = renderPublication()
    await act(() => result.current.pushProject())
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('error'))
    expect(vi.mocked(api.gitPush).mock.calls.map((call) => call[4])).toEqual(['clean', 'module'])
    expect(result.current.flow.operation?.message).toMatch(/module: Autenticação necessária.*1 repositório/)
    expect(result.current.flow.operation?.message).toContain('clean: já atualizado')
    expect(vi.mocked(api.gitOverview).mock.invocationCallOrder.at(-1)).toBeGreaterThan(vi.mocked(api.gitPush).mock.invocationCallOrder.at(-1)!)
  })

  it('preserves the publication error when refreshing the panel also fails', async () => {
    vi.mocked(api.gitPush).mockImplementationOnce(async () => {
      vi.mocked(api.gitOverview).mockRejectedValueOnce(new Error('Painel indisponível'))
      return { outcome: 'auth_required', remote: 'origin', branch: 'main', detail: 'Autenticação necessária' }
    })
    const { result } = renderPublication()
    await act(() => result.current.pushProject())
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('error'))
    expect(result.current.flow.operation?.message).toContain('clean: Autenticação necessária')
    expect(result.current.flow.operation?.message).toContain('Painel indisponível')
    expect(api.gitPush).toHaveBeenCalledTimes(1)
  })
})

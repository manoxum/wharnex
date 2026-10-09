import { states, setupGitChangesScenario } from './testing'
import { session } from '../testing/fixtures'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../../lib/transport/http/api'
import { useGitOperationFlow } from '../../../../lib/git/workflow/useGitOperationFlow'
import { useGitChangesActions } from './useGitChangesActions'

beforeEach(setupGitChangesScenario)

function renderActions() {
  return renderHook(() => {
    const entries = Array.from(states, ([path, overview]) => ({ repository: states.get('')!.repositories.find((repo) => repo.path === path)!, overview }))
    const loadOverview = () => api.gitOverview(session.id)
    const flow = useGitOperationFlow({ sessionId: session.id, availableEntries: entries, repositoryTargets: [], loadOverview, report: vi.fn(), setWorking: vi.fn(), setNotice: vi.fn(), setNoticeError: vi.fn() })
    const actions = useGitChangesActions({ sessionId: session.id, entries, selected: new Set(), message: 'fix: projeto completo', resetCommit: vi.fn(), flow, loadOverview, runForRepositories: vi.fn(), repositoryTargets: [] })
    return { flow, actions }
  })
}

describe('collective Git operation flow', () => {
  it('reviews all changes before committing children and their parent links with one message', async () => {
    const { result } = renderActions()
    await act(() => result.current.actions.commitAll())
    expect(result.current.flow.operation?.phase).toBe('reviewing')
    expect(result.current.flow.operation?.previews?.map((preview) => preview.repository)).toEqual(['module', ''])
    expect(api.commitGitWorktree).not.toHaveBeenCalled()
    expect(api.gitPreview).toHaveBeenCalledWith(session.id, { operation: 'commit', repository: 'module', paths: ['file.ts'] })
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('success'))
    expect(vi.mocked(api.commitGitWorktree).mock.calls.map((call) => call.slice(1))).toEqual([
      ['fix: projeto completo', ['file.ts'], 'module'], ['fix: projeto completo', ['module'], ''],
    ])
    expect(api.gitPush).not.toHaveBeenCalled()
  })

  it('requires a review of the new commits before publishing', async () => {
    const { result } = renderActions()
    await act(() => result.current.actions.commitPush())
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.title).toBe('A enviar commits de todos os repositórios'))
    expect(result.current.flow.operation?.phase).toBe('reviewing')
    expect(api.gitPush).not.toHaveBeenCalled()
    expect(api.commitGitWorktree).toHaveBeenCalledTimes(2)
    expect(api.gitPreview).toHaveBeenCalledWith(session.id, expect.objectContaining({ operation: 'push', repository: 'module', branch: 'main', remote: 'origin' }))
    expect(vi.mocked(api.gitOverview).mock.invocationCallOrder.at(-1)).toBeGreaterThan(vi.mocked(api.commitGitWorktree).mock.invocationCallOrder.at(-1)!)
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('success'))
    expect(vi.mocked(api.gitPush).mock.calls.map((call) => call[4])).toEqual(['module', ''])
  })

  it('publishes existing commits without making a commit or including clean submodules', async () => {
    const { result } = renderActions()
    await act(() => result.current.actions.pushAll())
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('success'))
    expect(api.gitPush).toHaveBeenCalledTimes(2)
    expect(api.commitGitWorktree).not.toHaveBeenCalled()
    expect(vi.mocked(api.gitPush).mock.calls.map((call) => call[4])).toEqual(['module', ''])
  })

  it('keeps the parent unpublished when pushing a child fails and refreshes displayed state', async () => {
    vi.mocked(api.gitPush).mockResolvedValueOnce({ outcome: 'auth_required', remote: 'origin', branch: 'main', detail: 'Autenticação necessária' })
    const { result } = renderActions()
    await act(() => result.current.actions.pushAll())
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('error'))
    expect(result.current.flow.operation?.message).toMatch(/Autenticação necessária.*0 repositório/)
    expect(api.gitPush).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.gitOverview).mock.invocationCallOrder.at(-1)).toBeGreaterThan(vi.mocked(api.gitPush).mock.invocationCallOrder[0])
  })

  it('stops after a failed commit and does not open the push review', async () => {
    vi.mocked(api.commitGitWorktree).mockRejectedValueOnce(new Error('Identidade inválida'))
    const { result } = renderActions()
    await act(() => result.current.actions.commitPush())
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('error'))
    expect(result.current.flow.operation?.message).toMatch(/Identidade inválida.*0 commit/)
    expect(api.commitGitWorktree).toHaveBeenCalledTimes(1)
    expect(api.gitPush).not.toHaveBeenCalled()
    expect(vi.mocked(api.gitPreview).mock.calls.some((call) => call[1].operation === 'push')).toBe(false)
  })

  it('reports a completed child commit when its parent fails and does not publish it', async () => {
    const commit = vi.mocked(api.commitGitWorktree).getMockImplementation()!
    vi.mocked(api.commitGitWorktree).mockImplementation((id, message, paths, repository = '', all) => repository
      ? commit(id, message, paths, repository, all)
      : Promise.reject(new Error('Falha no superprojeto')))
    const { result } = renderActions()
    await act(() => result.current.actions.commitPush())
    act(() => result.current.flow.operation!.onConfirmReview!())
    await waitFor(() => expect(result.current.flow.operation?.phase).toBe('error'))
    expect(result.current.flow.operation?.message).toMatch(/Superprojeto.*1 commit\(s\) já criado/)
    expect(states.get('module')!.working.clean).toBe(true)
    expect(api.gitPush).not.toHaveBeenCalled()
  })
})

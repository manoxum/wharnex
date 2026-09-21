import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { announceGitChanged, subscribeGitLiveSync } from './gitLiveSync'

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return { ...actual, api: { ...actual.api, gitHead: vi.fn() } }
})

describe('gitLiveSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(api.gitHead).mockResolvedValue({ current_branch: 'main', detached: false, commit_sha: 'a1' })
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('notifies subscribers when an external checkout changes', async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeGitLiveSync('ses_1', listener)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(listener).not.toHaveBeenCalled()

    vi.mocked(api.gitHead).mockResolvedValue({ current_branch: 'feature', detached: false, commit_sha: 'b2' })
    await act(async () => { vi.advanceTimersByTime(1000); await Promise.resolve(); await Promise.resolve() })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('fans out Wharnex-owned Git changes immediately', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = subscribeGitLiveSync('ses_2', first)
    const offSecond = subscribeGitLiveSync('ses_2', second)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    announceGitChanged('ses_2')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    offFirst(); offSecond()
  })
})

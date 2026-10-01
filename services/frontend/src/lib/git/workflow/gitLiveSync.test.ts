import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../transport/http/api'
import { openSessionEvents } from '../../transport/http/sessionEvents'
import { announceGitChanged, subscribeGitLiveSync } from './gitLiveSync'

vi.mock('../../transport/http/sessionEvents', () => ({ openSessionEvents: vi.fn() }))
vi.mock('../../transport/http/api', async () => {
  const actual = await vi.importActual<typeof import('../../transport/http/api')>('../../transport/http/api')
  return { ...actual, api: { ...actual.api, gitHead: vi.fn() } }
})

function source() {
  return { onmessage: null as null | ((event: { data: string }) => void), onerror: null, onopen: null as null | (() => void), close: vi.fn() }
}

describe('gitLiveSync', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('uses one session stream and no periodic git/head request', () => {
    const stream = source()
    vi.mocked(openSessionEvents).mockReturnValue(stream)
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = subscribeGitLiveSync('ses_1', first)
    const offSecond = subscribeGitLiveSync('ses_1', second)
    expect(openSessionEvents).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000)
    expect(api.gitHead).not.toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    stream.onmessage?.({ data: JSON.stringify({ type: 'git.changed', data: {} }) })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    offFirst()
    expect(stream.close).not.toHaveBeenCalled()
    offSecond()
    expect(stream.close).toHaveBeenCalledTimes(1)
  })

  it('refreshes after reconnect and fans out local Git actions', () => {
    const stream = source()
    vi.mocked(openSessionEvents).mockReturnValue(stream)
    const listener = vi.fn()
    const off = subscribeGitLiveSync('ses_2', listener)
    stream.onopen?.()
    expect(listener).toHaveBeenCalledTimes(1)
    stream.onopen?.()
    announceGitChanged('ses_2')
    expect(listener).toHaveBeenCalledTimes(3)
    off()
  })
})

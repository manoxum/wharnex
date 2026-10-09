import { afterEach, describe, expect, it, vi } from 'vitest'
import { openLiveEventStream } from './liveEventStream'
import { openSessionEvents } from './sessionEvents'

vi.mock('./liveEventStream', () => ({ openLiveEventStream: vi.fn() }))

describe('session event transport', () => {
  afterEach(() => vi.clearAllMocks())

  it('shares one socket, fans out frames, and closes after the last consumer', () => {
    const source = { onmessage: null as null | ((event: { data: string }) => void), onerror: null, onopen: null, close: vi.fn() }
    vi.mocked(openLiveEventStream).mockReturnValue(source)
    const first = openSessionEvents('/api/sessions/s1/events')
    const second = openSessionEvents('/api/sessions/s1/events')
    const onFirst = vi.fn()
    const onSecond = vi.fn()
    first.onmessage = onFirst
    second.onmessage = onSecond
    expect(openLiveEventStream).toHaveBeenCalledTimes(1)
    source.onmessage?.({ data: '{"type":"git.changed"}' })
    expect(onFirst).toHaveBeenCalledTimes(1)
    expect(onSecond).toHaveBeenCalledTimes(1)
    first.close()
    expect(source.close).not.toHaveBeenCalled()
    second.close()
    expect(source.close).toHaveBeenCalledTimes(1)
  })
})

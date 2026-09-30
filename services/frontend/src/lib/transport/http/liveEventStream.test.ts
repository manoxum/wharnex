import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openLiveEventStream, resetLiveEventStreamFallbackForTests, webSocketURL } from './liveEventStream'

class FakeSocket {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  constructor(public url: string) { FakeSocket.all.push(this) }
  close() { this.closed = true }
  open() { this.onopen?.() }
  drop() { this.onclose?.() }
}

class FakeEventSource {
  static all: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(public url: string) { FakeEventSource.all.push(this) }
}

describe('live event stream', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.all = []; FakeEventSource.all = []
    resetLiveEventStreamFallbackForTests()
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('EventSource', FakeEventSource)
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('resolves the API URL against the page and switches to the WebSocket scheme', () => {
    expect(webSocketURL('/api/sessions/s/events', 'http://127.0.0.1:6969/?w=1')).toBe('ws://127.0.0.1:6969/api/sessions/s/events')
    expect(webSocketURL('https://whx.example/api/sessions/s/events')).toBe('wss://whx.example/api/sessions/s/events')
  })

  it('delivers messages in EventSource shape and reconnects by itself after a drop', () => {
    const stream = openLiveEventStream('http://127.0.0.1:6969/api/sessions/s/events')
    const messages: string[] = []
    const errors = vi.fn()
    stream.onmessage = (event) => messages.push(event.data)
    stream.onerror = errors
    FakeSocket.all[0].open()
    FakeSocket.all[0].onmessage?.({ data: '{"type":"turn.received"}' })
    expect(messages).toEqual(['{"type":"turn.received"}'])

    FakeSocket.all[0].drop()
    expect(errors).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(2)
    expect(FakeSocket.all[1].url).toBe('ws://127.0.0.1:6969/api/sessions/s/events')
  })

  it('stops reconnecting once closed, including from its own error handler', () => {
    const stream = openLiveEventStream('http://h/api/x')
    stream.onerror = () => stream.close()
    FakeSocket.all[0].open()
    FakeSocket.all[0].drop()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(1)
  })

  // A gateway that predates WebSocket streams refuses every upgrade; the page
  // must keep its live events rather than retry a socket forever.
  it('falls back to EventSource when no socket has ever opened', () => {
    const stream = openLiveEventStream('http://h/api/x')
    const messages: string[] = []
    stream.onmessage = (event) => messages.push(event.data)
    for (let attempt = 0; attempt < 3; attempt += 1) {
      FakeSocket.all[attempt].drop()
      vi.advanceTimersByTime(15_000)
    }
    expect(FakeSocket.all).toHaveLength(3)
    expect(FakeEventSource.all.map((source) => source.url)).toEqual(['http://h/api/x'])
    FakeEventSource.all[0].onmessage?.({ data: 'frame' })
    expect(messages).toEqual(['frame'])
  })

  it('keeps retrying WebSocket after a restart once one has worked', () => {
    openLiveEventStream('http://h/api/x')
    FakeSocket.all[0].open()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      FakeSocket.all[attempt].drop()
      vi.advanceTimersByTime(15_000)
    }
    expect(FakeEventSource.all).toHaveLength(0)
    expect(FakeSocket.all).toHaveLength(6)
  })
})

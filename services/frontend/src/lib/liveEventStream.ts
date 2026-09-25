// Live session/terminal streams travel over WebSocket (adr/ADR-0076). On plain
// HTTP/1.1 every open EventSource holds one of the browser's six sockets for
// the backend host, shared by every Wharnex window; a few windows and
// terminals were enough to queue ordinary requests - artifact previews among
// them - for minutes. WebSockets are not drawn from that pool.
//
// The stream keeps EventSource's shape and semantics so consumers do not
// change: `onmessage` receives `{ data }`, `onerror` fires on every
// disconnect, and the stream reconnects by itself until `close()` is called.

export type LiveEventStream = {
  onmessage: ((event: { data: string }) => void) | null
  onerror: (() => void) | null
  onopen: (() => void) | null
  close(): void
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15_000
// A backend or gateway that predates WebSocket streams refuses every upgrade.
// If no socket has ever opened in this page, fall back to EventSource rather
// than leave the page without live events.
const FALLBACK_AFTER_FAILED_HANDSHAKES = 3
let socketEverOpened = false
let failedHandshakes = 0

export function openLiveEventStream(url: string): LiveEventStream {
  return new SocketEventStream(url)
}

export function webSocketURL(url: string, base = globalThis.location?.href) {
  const resolved = new URL(url, base)
  resolved.protocol = resolved.protocol === 'https:' ? 'wss:' : 'ws:'
  return resolved.toString()
}

export function resetLiveEventStreamFallbackForTests() {
  socketEverOpened = false
  failedHandshakes = 0
}

class SocketEventStream implements LiveEventStream {
  onmessage: LiveEventStream['onmessage'] = null
  onerror: LiveEventStream['onerror'] = null
  onopen: LiveEventStream['onopen'] = null
  private socket?: WebSocket
  private fallback?: EventSource
  private closed = false
  private attempt = 0
  private timer?: ReturnType<typeof setTimeout>

  constructor(private readonly url: string) { this.connect() }

  close() {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.socket?.close()
    this.fallback?.close()
  }

  private connect() {
    if (this.closed) return
    if (!socketEverOpened && failedHandshakes >= FALLBACK_AFTER_FAILED_HANDSHAKES) return this.connectEventSource()
    let opened = false
    const socket = new WebSocket(webSocketURL(this.url))
    this.socket = socket
    socket.onopen = () => {
      opened = true; socketEverOpened = true; failedHandshakes = 0; this.attempt = 0
      this.onopen?.()
    }
    socket.onmessage = (event) => { if (typeof event.data === 'string') this.onmessage?.({ data: event.data }) }
    socket.onclose = () => {
      if (this.closed || this.socket !== socket) return
      if (!opened) failedHandshakes += 1
      this.onerror?.()
      this.scheduleReconnect()
    }
  }

  private connectEventSource() {
    console.warn(`[live-stream] WebSocket unavailable after ${failedHandshakes} handshakes; using EventSource for ${this.url}`)
    const source = new EventSource(this.url)
    this.fallback = source
    source.onopen = () => this.onopen?.()
    source.onmessage = (event) => this.onmessage?.({ data: event.data })
    source.onerror = () => this.onerror?.()
  }

  private scheduleReconnect() {
    if (this.closed) return
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempt)
    this.attempt += 1
    this.timer = setTimeout(() => { this.timer = undefined; this.connect() }, delay)
  }
}

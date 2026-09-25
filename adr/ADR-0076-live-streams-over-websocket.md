# ADR-0076: Live session and terminal streams over WebSocket

**Status:** Accepted (2026-09-25). Amends the transport named in `adr/ADR-0053` §2.

## Context

On 2026-09-25 the 16 logo proposals returned for chat `754f4ffa-820d-4f76-83a5-e96f99833aab` stayed on "A abrir por stream…" for about five minutes, although the backend served every entry in under 30 ms. The gateway log showed the renderer's requests completing only when an unrelated session event stream closed: the Markdown guide two seconds after one stream ended, all 18 images in the same second as another.

The renderer reached the backend over plain HTTP/1.1, where Chromium opens at most six connections per host, and that pool is shared by every Wharnex window in the Electron session. Each open `EventSource` holds one of those connections indefinitely: one session event stream per window plus one per live terminal, and terminals stay subscribed while hidden (ADR-0053). A few windows and terminals were enough to leave every ordinary request queued behind them. The http.Server's 30-minute write timeout also cut each SSE stream periodically, which is what eventually released the queue.

## Decision

- Session event streams (`/api/sessions/{id}/events`) and interactive terminal streams (`/api/sessions/{id}/terminal/sessions/{terminal_id}/events`) are served over WebSocket when the client asks to upgrade, one JSON value per text message, exactly the payload the SSE `data:` line carried. Chromium does not draw WebSockets from the six-connection HTTP pool.
- The same endpoints still answer SSE to clients that do not upgrade, and the renderer falls back to `EventSource` when no WebSocket has opened in the page after three handshakes. A backend or gateway that predates this change therefore degrades to the old behavior instead of leaving the page without live events.
- The renderer stream (`services/frontend/src/lib/liveEventStream.ts`) keeps EventSource's shape and semantics: `onmessage({ data })`, `onerror` on every disconnect, and automatic reconnection with backoff until `close()`.
- Browsers do not apply CORS to WebSockets. The handshake therefore accepts only the configured frontend origins, a page whose origin is the host:port it connected through (`X-Forwarded-Host` behind the gateway), or a request without `Origin` (a non-browser client, which an origin check cannot constrain anyway). The paired-remote cookie check still applies to the upgrade request, because it runs before the handler.
- The server sends a WebSocket ping every 20 s, gives every write a 15 s deadline so a client that stops reading is dropped, and bounds client messages to 4 KiB. The client sends no data.
- The gateway forwards `Upgrade`/`Connection` and the original `Host` (with its port) as `X-Forwarded-Host` on the local listener. The remote listener is unchanged; the paired webapp uses no live streams.
- The server uses `golang.org/x/net/websocket`, already in the module graph, rather than a hand-written RFC 6455 parser.

## Consequences

- Returned artifacts, previews and every other request no longer wait behind live streams, whatever the number of windows and terminals.
- Live streams no longer end at the server's write timeout.
- The remote-input channel's read-only SSE (`SoT/CONTEXT_PROTOCOL.md`, ADR-0020) is a separate transport for external adapters and is not affected.

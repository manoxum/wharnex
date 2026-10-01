# ADR-0073: Durable terminal sidecar and stable PTY reconnection

**Status:** Accepted

## Context

Stack-mode Editor PTYs were coupled to application lifecycle in two places: Desktop launched the native PTY bridge, and backend shutdown closed every in-memory terminal. The renderer also treated component cleanup as terminal deletion. A Desktop reload, backend replacement or frontend remount therefore destroyed the shell while persisted tabs still referenced an id that the new backend could no longer resolve, surfacing `terminal session not found`.

The Editor terminal is human-only and should outlive ordinary application deployments. Its process lifetime must therefore have a different owner from the renderer, Desktop and application backend.

## Decision

- Stack mode runs a dedicated Compose `terminal` sidecar using `wharnex-terminald`. It owns Host PTY processes and is started with `--no-recreate` during ordinary stack reconciliation.
- The backend connects to `${WHARNESS_BRIDGE_DIR}/terminal.sock` and treats the connection as transport, not process ownership. Backend shutdown detaches Host transports instead of closing the sidecar PTY.
- Host terminal ids are stable reconnect keys. A reconnect carrying the same id and project root attaches to the existing PTY; the sidecar keeps a bounded output backlog while no backend transport is attached.
- Creation and reconnection are distinct bridge operations. A reconnect whose id is absent from the sidecar registry returns `terminal_expired` (HTTP 410 through the backend); it must never create a replacement shell under the old id. Each sidecar process exposes a random generation in its bridge handshake and expiry response. A changed generation clears persisted terminal workspaces for all projects; an individual expired shell in the same generation clears only its own id. A temporary bridge transport disconnect may retry the stable id while the sidecar still owns it.
- The frontend persists each tab's terminal id. Renderer remount/reload reconnects that id and does not send `DELETE` during component cleanup. Explicit tab/session close remains the terminal teardown boundary.
- Desktop no longer owns Host PTYs in stack mode. The native `wharnex-host-pty` helper remains Desktop-owned only for the restricted Host Git socket.
- Terminal-daemon implementation changes are a distinct self-evolution activation impact. Such a terminal-specific rollout may recreate the sidecar and therefore intentionally ends existing PTYs; unrelated backend/frontend/Desktop rollouts do not.
- Protected/sandbox compatibility PTYs remain backend-owned and may retain orphan cleanup because they are not the human Host terminal.

## Consequences

- Host shells created after this migration survive backend builds/restarts, Desktop reloads and frontend remounts.
- The first rollout cannot preserve PTYs created under the previous Desktop-owned bridge because those processes have no durable owner to migrate from.
- A bounded detached-output buffer avoids unbounded memory growth while still replaying recent output after reconnection.
- The sidecar runs with the configured Wharnex UID/GID and real home/project mounts, but its process environment/toolchain is the sidecar image's environment rather than the Desktop process environment.
- Explicit terminal close remains destructive by design and removes the stable id from the daemon registry.
- Restarting the terminal sidecar intentionally loses its registry and all PTYs; the next reconnect discards stale tab ids rather than presenting a silently replaced shell as a recovered session.
- An unavailable sidecar is reported distinctly (`terminal_daemon_unavailable`, HTTP 503). Existing tabs are invalidated immediately; a fresh tab may keep waiting for the daemon to return.
- Input from a short typing burst is sent as one ordered request. Output subscribers that fall behind are disconnected for replay instead of silently dropping frames; persisted viewport/history snapshots are throttled so active output does not continuously re-render the workspace.
- Bridge writes have a bounded deadline. A sidecar that stops reading input causes a transport exit and reconnect instead of leaving subsequent keystrokes queued behind an indefinitely blocked HTTP request.

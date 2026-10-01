# ADR-0086: Backend owned Git invalidation

## Decision

The Desktop shares one live event connection per session among the workspace,
Git surface, Editor and Explorer. One backend observer per project samples its
measured repositories while at least one live session stream is connected and
publishes a durable `git.changed` event for each subscribed session when the signature changes. The signature covers
HEAD, branch and tag refs, staged diff, worktree status and changed file metadata. The frame contains only
the session identity and event type; the client reloads authoritative snapshots.
Concurrent readers of the same GET snapshot share one in-flight HTTP request.

The first successful backend sample also notifies every newly attached stream,
closing the gap between WebSocket open and the observer's baseline. The first
connection and each reconnection trigger a refresh as a compatibility fallback.
Catch-up omits
historical Git invalidations so they cannot trigger a burst of rereads. A
quiet stream generates no Git HTTP requests. The `/git/head` endpoint remains
for older clients and explicit diagnostics. The existing session event stream
remains the notification path for other application events. It subscribes before
reading catch-up history and deduplicates the overlap by event ID, closing the
small gap that could lose an event during connection setup.

## Reason

The prior renderer had one `GET /git/head` every second per observed repository.
The badge, drawer and other surfaces could each stay mounted, multiplying
requests whose unchanged responses were `304`. Moving the observation behind
the existing live channel removes that HTTP cadence and lets the backend
coalesce multiple Git changes into a single invalidation at its sample boundary.

## Compatibility and limits

No wire schema used for execution changes. Git invalidations contain no diff,
path or content, and Git operations still publish their existing detailed
durable events. A missed invalidation is repaired by reconnect refresh. External
changes are visible by the next backend sample while the session is open.

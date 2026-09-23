# ADR-0070: Tunnel configuration is adopted on save, not on restart

Status: Accepted — 2026-09-23

## Context

The tunnel instance pool was built exactly once, at process start
(`remoteinput.NewTunnelManager`). Saving the provider pool from the UI wrote
`tunnel-providers.json` and answered `restart_required: true`, and the public
status deliberately shows only instances present in *both* the saved document
and the running pool (`mergeConfiguredTunnelURLs`).

The consequence was a silent trap. An operator who configured a provider saw a
correctly saved document, an empty "Túneis ativos" list, and no explanation
connecting the two. In stack mode it was worse than it looked: the pool lives in
the tunnel daemon, whose container is deliberately preserved across backend
rebuilds (`adr/ADR-0024`), so the restart people would naturally perform — the
backend's — did not adopt the change either.

## Decision

Saving the tunnel configuration adopts it immediately.

- `remoteinput.Manager` gains `ReloadRemoteInput`, which re-reads the saved
  document and reconciles the live pool.
- The daemon exposes `POST /v1/config/reload`. The backend asks for the reload
  but never sends provider definitions: the daemon re-reads the shared
  read-only document itself, so provider process lifetime stays on the daemon's
  side of the boundary required by `SoT/ARCHITECTURE.md`.
- `app.RemoteInputReloader` is an optional capability discovered by type
  assertion, matching how the other remote-input capabilities are already
  detected. Durable object stores do not implement it.

Reconciliation is conservative, because a tunnel is not a stateless value:

- An instance whose configuration is unchanged **keeps its running provider**.
  That provider owns a live public URL and the channel resources of requests
  still in flight, so rebuilding it because a *sibling* was added would
  invalidate both. Provider identity is compared on provider type, public URL,
  credential reference and local port.
- Priority is pure ordering and is adopted **without** reconnecting anything.
- An instance removed from the document has its connector stopped. It is
  stopped, not cleared: erasing stored channel resources remains an explicit
  operator action, as `adr/ADR-0023` already requires.
- Every new provider is constructed **before** anything is swapped in. If one
  fails to start, the live pool is left exactly as it was rather than
  half-applied, and the error is reported.
- A provider that survives a reload has its discovery landing page refreshed,
  so renaming the instance or adding a sibling origin is reflected without
  dropping the tunnel.

### The daemon stays alive through provider failure

Hot reload is only useful if there is a daemon left to receive it, so two
startup paths that called `log.Fatalf` no longer exit:

- A configuration that cannot be built serves an empty pool and logs why.
  Correcting it means saving again, which requires the daemon to be running.
- A provider that fails to connect is an operational condition, not a fatal
  one. Exiting there crash-looped the container under `restart: unless-stopped`
  and took down the whole tunnel service — including the endpoints the UI needs
  in order to show *why* a tunnel is unavailable. Each failed instance is
  already recorded as unavailable with its reason and surfaced through `Status`.

An instance introduced by a reload has its session started immediately, so an
added tunnel publishes its URL instead of waiting for the first request to need
it. That start follows the same rule: a failure is recorded and reported, never
fatal, and never fails the reload for the instances that did connect.

`restart_required` is no longer hardcoded. It is now computed: it stays true
when the transport cannot reload, when the reload fails, or when the runtime
still differs from the saved document, so the operator is never told a change
is live when it is not.

## Consequences

- Configuring a tunnel takes effect immediately; the empty-list trap is gone.
- The reload is a pool reconciliation, not a restart, so unrelated active
  tunnels and in-flight requests survive a save.
- `restart_required` becomes meaningful rather than constant, and remains the
  honest signal for the cases a reload genuinely cannot cover.
- The tunnel daemon gains one authenticated internal endpoint. It carries no
  payload, which keeps configuration authority in the shared document rather
  than in the call.

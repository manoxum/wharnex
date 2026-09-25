# ADR-0075: One classified operational log for everything the engine does

**Status:** Accepted (2026-09-25). Phases 1 and 2 implemented; phase 3 pending.

## Context

Diagnosing two stalled requests on 2026-09-25 required stitching four sources by hand: the nginx access log of the gateway (lost whenever the container is recreated), the Desktop `desktop.log` (about 130 `console.*` calls across ~40 channels, written as plain text **without timestamps**), the per-session `harness_events` ledger, and the browser-agent queue tables. Session-less activity (startup, queue sweeps, provider rate limits, self-evolution without a session) had no durable home at all, and nothing carried a common classification. At the same time a third of `harness_events` (38 453 of 115 654 rows) was reconciliation noise re-published on every session read, with no retention.

## Decision

- **One store, `harness_operational_log`.** Every record carries `occurred_at`, `source` (`backend` | `desktop` | `frontend`), `component`, `level` (`trace` < `debug` < `info` < `success` < `warning` < `error`), `category`, `event`, a bounded `message`, correlation (`session_id`, `request_id`, `root_request_id`, `chat_id`, `task_id`, `plan_id`, `project_id`) and a bounded `data` object.
- **Referenced, not duplicated.** A record mirrored from `harness_events` stores `event_ref` = that event's id and only small scalar fields. Complete plan, execution and error bodies stay in their owning ledgers (`plan.recorded`, `execution.recorded`, `harness_execution_errors`), which remain authoritative for chat history and archives.
- **Classification is engine-owned and closed.** Component, level and category derive from the event name by a fixed table (`internal/oplog/classify.go`), never from localized prose.
- **Everything the backend does is captured.** Every audit-bus event is mirrored, and the backend's own `log` output is recorded as `component=backend-log`.
- **The Desktop is captured.** Every `console.log/warn/error` gains an ISO timestamp in `desktop.log` and is shipped in bounded batches to `POST /api/operational-log`. Correlation (`key=`, `request=`, `task=`, `slot=`) is parsed from the structured line.
- **Recording can never hurt the work it records.** The backend writer is asynchronous and bounded; when full it drops and counts. The Desktop shipper is bounded, times out and never throws. A failed write is reported on stderr, never through `log`, so recording cannot recurse.
- **Same redaction as every durable event.** Records pass `audit.SanitizeEventData`/`SanitizeText`; secrets, cookies, storage and assistant prose never enter the log.
- **Local only.** The ingest and query endpoints refuse requests arriving through the paired remote ingress (`X-Wharnex-Remote: 1`).
- **Retention: automatic cleanup at 15 days.** `trace`/`debug` records expire after 3 days, every other record after 15 days. The same hourly sweep deletes operational-noise event types (`command.output`, build output, git fetches, status reconciliation, context refresh) from `harness_events` after 15 days. The plan/execution/error ledger is chat history and is not swept by age.

### Phase 2 — HTTP calls and trace propagation

- A middleware directly around the route mux observes every backend call: matched route pattern, path, status, duration, request/response bytes, remote ingress flag, and correlation read from the route (`/sessions/{id}` → session, `/chat-agent/tasks/{id}` → task, `/workspace-chats/{id}` → chat, `{request_id}` or `?request_id=` → request). It keeps `http.Flusher`, which the live event stream asserts.
- `oplog.HTTPDisposition` decides individually or aggregated: every 5xx (error), every 4xx and every call of 2 s or more (warning), every mutation (success), every request-input transport call (`bundle`, `context/maps`, `git/context`, `knowledge`, `continuation`, artifact download) and every event stream close are individual `http.request` records. Healthy polling — task claims (measured at ~12.5/s), heartbeats, periodic `git/fetch`, the ingest itself — and fast reads fold into one `http.calls_aggregated` debug record per route per minute with count, errors, average/max duration and bytes.
- `X-Wharnex-Trace` correlates one operation across processes. The backend echoes a well-formed trace (`[A-Za-z0-9:_.-]{1,120}`) and generates one otherwise. The Desktop runs every scheduler attempt in `task:<task_id>:<attempt>` and every transport preparation in `prepare:<request>:<stamp>` through `AsyncLocalStorage`, adds the header to calls addressed to the local backend only, and stamps the same trace on every console line. `trace_id` is a column and a query filter.

## Consequences

- One query answers "what happened to request X / chat Y / in the last hour", across the backend and the Desktop.
- A stalled request is now reconstructed with one query by `trace_id` or `request_id`: the Desktop lines, the backend calls they caused with their durations, and the backend events.
- Phase 3: an operational log view in the UI and export of a filtered slice as a diagnostic dossier for correction and self-evolution.

# ADR-0075: One classified operational log for everything the engine does

**Status:** Accepted (2026-09-25). Phase 1 of a staged rollout.

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

## Consequences

- One query answers "what happened to request X / chat Y / in the last hour", across the backend and the Desktop.
- Phase 2: HTTP call records — every mutation, error, slow call (>2 s) and transport call individually, with healthy polling aggregated per minute — plus a propagated trace id from Desktop/frontend to backend.
- Phase 3: an operational log view in the UI and export of a filtered slice as a diagnostic dossier for correction and self-evolution.

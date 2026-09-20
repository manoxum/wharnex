# ADR-0064 — Durable Main Request decision ledger

## Status

Accepted.

## Context

Diagnosing a "keep continue" race (a recovery decision firing while a bundle
download the same click had just triggered was still resolving) was only
possible by grepping `.harness/logs/desktop.log` — an ephemeral, rotating,
local file. Every decision the ChatGPT transport/recovery layer makes around
a Main Request — a recovery reload, a keep-continue wake-up, a bundle
validated or rejected, a manual or automatic re-request, a human escalation —
existed only as `console.log`/`console.warn` plus a transient IPC push to the
renderer. None of it was durable, none of it was queryable by request, and it
was gone once a chat was archived or the log rotated.

This is narrower than the existing durable plan/execution ledger
(`SoT/OBSERVABILITY.md` §"Durable plan and execution ledger"), which covers
the planner's own plan/execution bodies but not the ChatGPT-transport
automation layer that submits and supervises the request in the first place.

A related gap surfaced during the investigation: every Main Request already
creates a durable task row (`AWAIT_RESPONSE` in `harness_chat_agent_tasks`),
even when it runs on the visible Supervisor pool rather than being queued for
a Worker — pool assignment is a claim-time detail, not a different data model
(`AGENTS.md` §8: Supervisor-owned types share the same table/lease machinery
as Worker types). But that enqueue was best-effort: a failure was caught and
only `console.error`-ed, so a Main Request could proceed with the prompt
already sent to ChatGPT and zero durable record of it anywhere.

## Decision

### A task-anchored event ledger

`harness_chat_agent_task_events` (see `services/backend/internal/session/chat_agent_task_events.go`)
durably records one row per decision, keyed by `task_id` with `request_id`/
`root_request_id` denormalized for cross-task correlation (e.g. the initial
`AWAIT_RESPONSE` task plus a later `RECOVERY_WRITE` task for the same Main
Request). This mirrors the `plan.recorded`/`execution.recorded` pattern but
uses the chat-agent task table's own indexed identity instead of scanning
JSON bodies in `harness_events`, because the query this ledger exists to
answer — "everything that happened around this Main Request" — is already
shaped by that identity.

Event `data` is sanitized through the same rules `audit.Bus.Publish` applies
(`audit.SanitizeEventData`, exported for this reuse), so "Secret values must
be redacted before event publication" and the nested-array bounded-string
rule apply here exactly as they do to every other durable ledger.

Recording an event is best-effort from the caller's perspective:
`ChatAgentSchedulerClient.recordTaskEvent` (services/desktop/chat-agent-scheduler.mjs)
catches and logs rather than throwing, because a failure to record
observability must never fail the automation it describes.

Four choke points cover the decision surface without instrumenting every
scattered `console.*` call site individually:

- `performChatGPTRecoveryAction` — recovery reload and automatic keep-continue.
- `setChatGPTHumanAction` — the single existing choke point for every
  human-escalation call site (16+ across `main.mjs`).
- The bundle download's `will-download`/`done` handler — bundle validated and
  bundle rejected (with the running `invalidBundleCount`).
- `recordChatGPTContinuationSent` — called from both the manual "Retomar
  pedido" IPC handler and the automatic Worker-pool `CONTINUE_REQUEST` path,
  distinguishing `trigger: 'manual' | 'automatic'`.

### Main Request task creation is guaranteed, not best-effort

`enqueueChatAgentTask` gains an opt-in `retry` mode; `enqueueChatAgentFollowups`
(the function both submission paths call right after a prompt is confirmed
sent) uses it and returns the queued task so its callers can anchor the
in-memory expectation's `mainRequestTaskId`. When every retry is exhausted,
the caller disarms the in-memory expectation and fails the submission instead
of leaving a live expectation with nothing durable behind it.

This is a deliberate behavior change: a Main Request whose prompt was already
sent to ChatGPT can now surface as a failed submission if the backend is
briefly unreachable at the moment its tracking task would be created, where
it previously proceeded silently untracked. The operator sees an explicit
error and can retry, rather than the automation running an orphaned
expectation that a Desktop restart would never recover.

## Consequences

- Every recovery/bundle/escalation/continuation decision for a Main Request
  is queryable by `task_id` or by `root_request_id`/`request_id` via
  `GET /api/chat-agent/tasks/{id}/events` and
  `GET /api/chat-agent/tasks/events?root_request_id=...`, and survives a
  Desktop restart and chat archival.
- A backend outage now blocks new Main Request submissions rather than
  degrading silently; this trades a small amount of availability for the
  guarantee that no Main Request exists without a durable trace.
- Event volume is bounded the same way task history is: settled task rows are
  swept on a retention window (`SoT/OBSERVABILITY.md` §"Browser-agent queue
  observability"), and `harness_chat_agent_task_events` should be pruned
  alongside its owning task rather than retained indefinitely — a durable
  ledger for automation diagnostics, not a permanent audit trail.
- The frontend's `ChatAgentTasksDrawer` gains a per-task "Ver histórico"
  timeline reading this ledger, so the data is inspectable without a direct
  database query.

# ADR-0038 — Supervisor/worker ChatGPT runtime, durable queue, and behavior documents

## Status

Accepted. This decision supersedes the per-chat renderer ownership model from
ADR-0006 and the renderer-rehydration/background-poller portions of ADR-0012
and ADR-0037.

## Context

A dedicated ChatGPT `WebContentsView` per Harness chat made Chromium cost grow
with chat count and spread automation state across renderer lifetime, React pane
lifetime, and ad-hoc background timers. A large workspace therefore paid for
many idle renderers while still lacking one durable scheduler that could recover
work after a Desktop restart or serialize operations on the same remote
conversation.

The durable identities are already available independently of a renderer:
Harness `chat_id`, provider `conversation_id`, and Wharness `request_id`.
Renderers should execute work for those identities rather than own them.

## Decision

### Two Supervisor slots and a bounded autonomous worker pool

For one authenticated ChatGPT profile/Desktop process, Wharnex owns exactly two
**Supervisor** browser slots (one visible human-facing surface and one warm/standby) plus a configurable pool of one to six persistent
**Worker** browsers that are hidden by default, with six workers as the default. They share only
the dedicated authenticated ChatGPT browser partition. The pool is global across
projects and windows, so chat count does not change remote renderer count. Operators
may resize only the Worker pool; the Supervisor remains exactly one exclusive human
surface.

The active Supervisor is the normal interactive chat surface: selected-chat navigation,
the first user submission, and user comments. Background scheduler jobs never use either
Supervisor slot. On chat switch, a Supervisor that is still committing a write finishes
that write and then becomes standby; the other idle Supervisor can load the newly selected
chat immediately. If both slots are writing, navigation is deferred fail-closed until one
slot is reusable.
For diagnosis and recovery, the trusted local Agent runtime drawer may explicitly
surface exactly one existing Worker view inside a bounded interaction host, or choose
**Seguir (flow)** to move that same live Worker instance into the main Engine browser area. This does
not change scheduler ownership, grant generic navigation/DOM/session IPC, or stop the
Worker's current non-preemptive task. The Worker returns to hidden state when the
interaction ends, the frontend renderer exits, or its owning window closes. During composer/upload/submit critical phases it holds a
navigation/write lease. If the user switches chats meanwhile, Wharnex records
the latest desired chat and navigates there only after submission is confirmed.

Workers execute autonomous jobs. Scaling up creates additional hidden-by-default slots without
restarting the scheduler. Scaling down is non-preemptive: excess busy workers finish
their current job before their renderer is retired. Affinity is only a cache preference:
`chat_id -> conversation_id` is durable state, and a worker may be rebound after
finishing its non-preemptive job. A reached conversation becomes that slot's resident
lane for 60 seconds by default (never below 30 seconds). Resident work is preferred;
free slots claim unresident lanes before any resident slot is evicted; and, when chats
outnumber slots, only the head of a fair in-memory rotation may rebind after its dwell.
Cross-chat navigation starts share one profile-global 30-second gate. Each rebind
increments an assignment epoch so late callbacks cannot mutate the next assignment,
and write/upload transport is serialized by physical slot rather than chat id.
Project-scoped ChatGPT URLs do not change the canonical conversation identity.

### PostgreSQL is the browser-job source of truth

The backend persists typed tasks with `task_id`, `type`, `project_id`, `chat_id`,
`session_id`, `request_id`, `root_request_id`, `conversation_id`,
`parent_task_id`, `priority`, `status`, `not_before`, `attempt`, `max_attempts`,
`dedupe_key`, lease fields, payload/error fields, and timestamps. Electron only
claims leases and executes browser work.

Task states are `PENDING`, `LEASED`, `RUNNING`, `WAITING`, `DONE`, `FAILED`,
`ATTENTION`, and `CANCELLED`. Expired leases are safely reclaimed. Writes are
never deduplicated; idempotent work uses a dedupe key. Child tasks are created
instead of mutating a task into a new type.

Scheduling priority is:

1. P0 `BOT_WRITE`, `RECOVERY_WRITE`;
2. P1 due `AWAIT_RESPONSE`;
3. P2 `TITLE_DISCOVER`, title fallback, `ORGANIZE_CHAT`, `RENAME_CHAT`;
4. P3 `ARCHIVE_CHAT`, `DELETE_CHAT`;
5. P4 `DELETE_BUNDLE`, `DELETE_TEMP_CHAT`.

FIFO applies inside effective priority and lower-priority maintenance ages
toward P1. A global account-operation lock serializes rename/move/archive/delete
work. A per-conversation remote-write lock prevents writers from overlapping
one another or an await probe on the same conversation.

### Awaiting is a bounded probe, not a parked browser

`AWAIT_RESPONSE` runs on the already-resident canonical conversation, checks only
allowlisted structural health/completion state and the exact expected bundle affordance,
and never focuses the composer or reloads a healthy page. While generation is active it
returns to `WAITING` on a fixed roughly 30-second observation cadence so the worker is
released without turning normal generation into failure backoff. A completed turn
without the canonical bundle may create one bounded `RECOVERY_WRITE` child.
Request-bound follow-ups are initially ineligible for at least one minute. Once three
valid samples exist, the delay is `clamp(max(60s, (60s + average)/2), 60s, 15m)`, using
only the newest 50 structurally parsed processing-duration disclosures associated with
validated canonical bundles. Missing or ambiguous disclosures create no sample.
CAPTCHA/auth/provider-wide gates move work to `ATTENTION`; HTTP 429 uses a durable
60/120/240/300-second progressive breaker and resumes through the global navigation
gate instead of producing parallel retry storms.

`BOT_WRITE`/`RECOVERY_WRITE` acquire the per-conversation write lease and create
exactly one `AWAIT_RESPONSE` only after the conversation POST is confirmed and a
stable `conversation_id` exists. That POST confirmation is the write commit point:
remote-state persistence and await scheduling failures after it are supervision
failures, never permission to issue the write again. Persistence is best-effort; if
the await task cannot be durably scheduled, the submitted request moves to
`ATTENTION` instead of spawning a duplicate `RECOVERY_WRITE`. User comments remain
Supervisor operations and do not create a second await lineage.

### Conversation organization and lifecycle are idempotent jobs

The first confirmed submission persists the conversation binding immediately
and independently enqueues response waiting and native-title discovery. The
provider's native title is accepted only after stable reads. A temporary title
conversation is a bounded fallback, not the normal path. Organization performs
exact project lookup/create, move, rename, confirmation, and local remote-state
sync; ambiguous duplicate projects require attention.

Archive/delete jobs honor active request/recovery/write guards and treat already
completed remote state as success. Cleanup jobs are exact-identity and
retention-aware; a truncated/fuzzy library filename is never enough to delete an
artifact.

### Behavior remains data-driven and fail-closed

Provider selectors, labels, budgets, optional capabilities, anomaly snapshots,
and visible-reasoning rules remain in `harness.chat-agent-behavior/v1` behavior
documents. Scripts locate controls; trusted native input commits account menu
actions. Missing or ambiguous controls fail closed rather than clicking nearby
UI. Generated assistant prose, cookies, storage, and unrelated conversations
remain outside the automation inspection boundary.

## Consequences

- Thirty or more chats still use two Supervisor slots plus a bounded one-to-six Worker pool (six by default).
- Browser lifetime is no longer chat lifetime; durable identity and queue state
  survive Desktop restart independently of renderer state.
- Background work can never navigate the user's visible browser.
- `not_before`, leases, dedupe keys, lineage, and provider pause make recovery
  observable and retry-safe instead of timer-driven.
- React renders the normal Supervisor surface; a local management drawer may display
  bounded runtime metadata, capture a user-triggered browser snapshot, and temporarily
  surface exactly one Worker for explicit direct interaction. Snapshot/interaction are
  local and explicit, do not expose remote DOM/session material through IPC, and do not
  transfer scheduler ownership or persist generated assistant prose.
- Worker busy state is reconciled from durable `LEASED`/`RUNNING` task lease owners in
  addition to low-latency scheduler events, so reopening the drawer cannot make an
  executing Worker appear available merely because an in-memory event was missed.
- Worker jobs remain non-preemptive. Their probes/actions are therefore bounded
  so a newly arrived P0 write is delayed only by a short current job.

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
that write and then becomes standby. The new local chat opens immediately, but its remote
Supervisor remains hidden/deferred until the different chat's composer transaction ends.
The authenticated provider partition is shared, and live evidence showed that exposing the
standby surface mid-write can reflect provider cross-tab draft state even while the physical
write stays correctly addressed to the original `WebContents`. If both slots are writing,
navigation remains deferred fail-closed until one slot is reusable. The switch intent hides
the outgoing native view before the frontend
waits for the selected chat's Session. This is required even though the old write remains
correctly keyed: otherwise its native pixels keep painting above the newly selected React
chat and present a correctly isolated write as visible cross-chat contamination.

The transport captures one physical Supervisor entry before preparation and carries that
same reference through every asynchronous fill, upload, submit and retry step. Each step
revalidates ownership against the original chat key; mutable selected-chat lookup is never
used as an ownership mechanism.

Planner workflow, repair and delivery continuations are background scheduler work even
when the frontend orchestration loop originates them. They are durable
`BOT_WRITE`/`RECOVERY_WRITE` jobs executed by hidden Workers. Sending them through the
Supervisor lets an old chat rebind the visible surface while the operator types in a new
chat, producing focus theft and apparent cross-chat input. Automated DOM scripts stage
values without `focus()` or selection mutation and submit only through the owned,
structurally located send control; a missing control fails closed instead of emitting an
unscoped Enter key.
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

Residency stays a cache and never becomes ownership. A resident slot only claims its
own lane, so the lane it is holding is exactly the lane it has proven empty: after its
dwell, a bounded run of claims that find no work releases the lane and returns the slot
to the free pool. Without that release the pool degraded to a single effective worker —
every slot pinned to a conversation that had already been resolved, with only the
rotation head able to escape and only while no slot was free. For the same reason a slot
that is blocked from claiming (interaction, account operation, transport preparation,
loading) does not reserve its lane against the rest of the pool: a lane nobody can serve
is a conversation the queue cannot reach at all, and the backend's per-conversation write
lock already owns conflict safety.

Cross-chat navigation starts share one profile-global gate whose width is derived from
the provider's own durable 429 evidence: a healthy provider uses a short floor, and each
rate-limit level widens it up to the protective 30-second ceiling. A fixed ceiling applied
while ChatGPT is answering normally serializes the whole pool behind one clock, which buys
idleness rather than protection. Each rebind
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
`ATTENTION`, and `CANCELLED`. Expired leases are safely reclaimed. Conversation
writes are never deduplicated; exact idempotent artifact work uses a dedupe key. Child tasks are created
instead of mutating a task into a new type.

Scheduling priority is:

1. P-1 exact artifact utilities `TRANSLATE_MARKDOWN`, `ORCHESTRATOR_PLAN`;
2. P0 `BOT_WRITE`, `RECOVERY_WRITE`;
3. P1 due `AWAIT_RESPONSE`;
4. P2 `TITLE_DISCOVER`, title fallback, `ORGANIZE_CHAT`, `RENAME_CHAT`;
5. P3 `ARCHIVE_CHAT`, `DELETE_CHAT`;
6. P4 `DELETE_BUNDLE`, `DELETE_TEMP_CHAT`.

FIFO applies inside effective priority and lower-priority maintenance ages
toward P1. A global account-operation lock serializes rename/move/archive/delete
work. A per-conversation remote-write lock prevents writers from overlapping
one another or an await probe on the same conversation.

### Awaiting is a bounded probe, not a parked browser

`AWAIT_RESPONSE` runs on the already-resident canonical conversation, checks only
allowlisted structural health/completion state and the exact expected bundle affordance,
and never focuses the composer or reloads a healthy page. While generation is active it
returns to `WAITING` on a fixed roughly 30-second observation cadence so the worker is
released without turning normal generation into failure backoff.

A conversation that is producing a response is quiet. While an `AWAIT_RESPONSE` for a
conversation is still claimable, no task that drives that conversation's own surface —
`ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `TITLE_DISCOVER`,
`TITLE_GENERATE_TEMP` — may be claimed for it, and the enforcement belongs in the claim
query because the lease lock cannot express it: `AWAIT_RESPONSE` spends almost all of its
life in `WAITING` so the worker is released between observations, which left a window
every cycle in which account work could take the very conversation the model was writing
into. Each of those tasks navigates or mutates that renderer — organizing clicks a
project anchor, which is a real `/g/g-p-…` navigation; archive and delete click ChatGPT's
own Stop control; the temporary-title fallback sends the worker to a new chat and submits
an unrelated prompt there — so running one mid-generation destroys the response. A
supervision past its attempt budget is excluded from the rule, or a dead await would
silence its conversation permanently instead of until the response settles. For the same
reason the resident slot keeps its lane while it is between observations: handing the
conversation to another slot would reload a page the model is still writing into.

A terminal "finished without delivering" conclusion requires evidence that the turn
actually ran. The grace window is measured from the moment the generating indicator
disappeared, which presupposes it was seen; when it never was, the only available signal
is "the page has looked static since we first looked" — equally true of a turn that has
not started, of a gap between reasoning phases, and of a tool call with no visible
marker. That case therefore uses a substantially longer settle window, and supervision
scheduled immediately after a write waits the same initial delay as a first request so
its first probe cannot read the turn before the one it is supervising.

Every probe outcome in which nothing was attempted is an observation and gives back the
increment the claim charged: a still-generating page, a slot that was not on the expected
conversation, an active provider cooldown, and a page in neither a generating nor a
completed state. Charging those retired healthy supervisions with "exhausted maximum
attempts while waiting" while the model was still working. Because observations are free,
the ambiguous state carries its own evidence-shaped bound instead: a page showing no
structural sign of life at all for a bounded stall window moves to `ATTENTION`, and any
generating, completion or download signal resets that window. A completed turn
without the canonical bundle may create up to three spaced, same-request
`RECOVERY_WRITE` children. Each continuation resumes unfinished analysis,
tool use, implementation and verification before requesting delivery; it never
changes scope or starts a new main request.
Request-bound follow-ups are initially ineligible for at least one minute. Once three
valid samples exist, the delay is `clamp(max(60s, (60s + average)/2), 60s, 15m)`, using
only the newest 50 structurally parsed processing-duration disclosures associated with
validated canonical bundles. Missing or ambiguous disclosures create no sample.
CAPTCHA/auth/provider-wide gates move work to `ATTENTION`; an isolated HTTP 429 uses a
durable 60/120/240/300-second progressive breaker and resumes through the global
navigation gate instead of producing parallel retry storms. An account-wide rate-limit
gate is a distinct kind: ChatGPT's own limit control, or repeated refusals from any
trusted backend endpoint within a short window, suspends the provider durably for 30
minutes. During that suspension workers stop claiming — a claim charges an attempt, so
claiming through a cooldown burns the bounded retry budget of tasks that never reached
ChatGPT — and the gate pins the rate-limit level at its ceiling so navigation and
submission spacing resume staged rather than at the healthy floor. A rate-limit gate
clears on its own and therefore never becomes a human-action kind.

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

Queueing a chat deletion is the point at which that chat's remaining work stops being
useful, so the queue converges there: enqueueing `DELETE_CHAT` cancels the chat's other
claimable tasks and keeps only the remote cleanup jobs. Convergence lives in the store
rather than in a caller, so the REST delete path and the Desktop lifecycle bridge reach
the same state. Without it a deleted chat left response supervision, title discovery and
organization claimable forever, pinning workers to conversations the user had abandoned
and holding the one global account lock against chats that were still live.

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
- Queue diagnostics distinguish work claimable by another Worker from work waiting
  on `not_before` or on the same provider/account/conversation guards enforced by
  the durable claim; idle capacity is never offered as the remedy for protected work.
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

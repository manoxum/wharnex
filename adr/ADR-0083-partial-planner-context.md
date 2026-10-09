# ADR-0083 — Partial planner context

Status: Accepted — 2026-09-29

## Decision

New chat sessions start in Partial context mode. The operator may choose Full
in session settings or the Chat composer before a request. Full preserves the
previous request ZIP behavior. Existing sessions with no modality field remain
Full for compatibility. The selected mode applies to Orchestrator planning and
is inherited by each Orchestrator execution Agent session.

The backend still captures the complete eligible snapshot and its SHA-256
baseline. Partial changes only what reaches the model: inventories and source
metadata first, then exact file bodies selected through a typed response. Agent
responses use `harness.turn/v1` kind `context_request` with `context_paths`;
Orchestrator planning responses use `context-request.json` with
`harness.orchestrator-context-request/v1`. Each request names exact archive
paths from `context/`, `ref-context/` or `att-context/`. The backend checks
paths against the captured snapshot and bounds rounds and cumulative bytes; path count is not a protocol limit.
It reads the snapshot itself; model output never becomes a shell command or
host path. The cumulative selection travels in each follow-up ZIP.

The separate Orchestrator planning Worker remains in the same ChatGPT
conversation between context increments. A normal plan response ends planning.
Orchestrator execution reuses the ordinary Agent request and response protocol.

## Compatibility and migration

Persisted sessions without `context_mode` continue in Full. New request
manifests add optional `context_mode` and `context_paths` fields. Existing
plan and answer response bundles remain valid. A `context_request` is legal
only for a Partial request; old planners may answer directly without asking
for more files. Legacy Orchestrator JSON deliveries remain readable for
already checkpointed tasks.

## 2026-09-30 clarification

Partial context selection is byte-budgeted rather than file-count-budgeted. A request may name any number of unique captured paths that fit within the immutable snapshot, the 64 MiB cumulative selected-context budget (the six-increment bound originally stated here was removed on 2026-10-01). Ranking/grouping in context maps is advisory and MUST NOT impose a path-count ceiling.

## 2026-10-01 amendment — no increment-round limit

The six-increment bound is removed for both Agent `context_request` and
Orchestrator `context-request.json` increments. The planner decides when the
selected evidence suffices; Wharnex no longer rejects an increment by round
count, and the continuation prompt and semantic-index budget no longer state a
ceiling (`round_limit: "none"`, `rounds_remaining` dropped). Snapshot
membership, path safety, repeated-request rejection and the 64 MiB cumulative
byte budget remain the bounds.

Increments still advance the Main Request's round counter, but they are now
counted separately (`context_increments` on the session) and no longer spend
the executed workflow step budget, which stays at six ordinary steps.

Compatibility: sessions persisted without `context_increments` treat every
earlier round as an executed step, which is the previous, more conservative
behavior. Planners that read `rounds_remaining` simply no longer see it.

## 2026-10-05 amendment — normative seed from the first archive

A Partial Main Request no longer starts from maps alone. Before the planner is
asked, Wharnex seeds the cumulative selection with the primary project's
normative documents — root `AGENTS.md`, `SoT/**/*.md`, root `SECURITY.md` and
every scoped `AGENTS.md`, in that authority order, bounded to 8 MiB — so the
first request archive already carries the rules the change must follow. A
planner that reads the rules only after it has planned, or never asks for
them, produces work the project's own gates then reject.

The seed is ordinary selected context: the prompt lists it as already
selected, increments accumulate on top of it, and it counts toward the 64 MiB
budget. An Orchestrator planning request is seeded the same way when it
includes context, and its seed is recorded as that request's cumulative
selection. The Desktop path-count ceiling on a selection (128) is removed:
path count was never a protocol limit, and the seed alone could reach it.

Compatibility: no wire field changes. Older planners simply see more selected
bodies; a `context_request` that names only seeded files adds nothing and is
rejected exactly like any other repeated request.

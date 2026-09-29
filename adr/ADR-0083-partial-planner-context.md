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
paths against the captured snapshot and bounds rounds, file count and bytes.
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

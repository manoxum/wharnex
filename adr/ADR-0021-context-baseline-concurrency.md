# ADR-0021: Context-baseline concurrency control

## Status

Accepted.

## Context

Multiple Harness chats may prepare changes concurrently from the same project snapshot. A successful host Apply by one chat changes the project while another chat is still planning or holding a verified candidate. Applying the second candidate without re-evaluation creates avoidable patch collisions and can make otherwise valid verification stale.

Wharness already computes a deterministic managed-context `manifest.sha256`. That fingerprint includes eligible project content plus stable Git status/worktree metadata, while volatile runtime diagnostics do not participate in managed-context fingerprinting.

## Decision

Wharness uses optimistic concurrency control (OCC) around the context fingerprint, plus project-scoped serialization at every Harness-controlled host mutation boundary.

1. Every planner request records the current context SHA-256 by `request_id`.
2. Every new execution plan carries `base_context_sha256` and a conservative `impact_files` forecast.
3. Legacy/manual plans that omit the new fields are enriched from the request baseline before validation/execution.
4. Immediately before execution Wharness rebuilds context. A baseline mismatch makes the plan stale and enters the bounded repair/adaptation loop instead of executing it.
5. Protected Apply and Unprotected direct execution are serialized by canonical project root. Apply rebuilds context while holding that project lock and refuses a verified candidate whose recorded baseline no longer matches.
6. Successful Apply/Revert rebuilds context and emits a peer baseline notice containing old/new hashes, changed files, whether the delta is complete, and forecast overlap.
7. A complete chain of known non-overlapping deltas may fast-forward a late plan/bundle to the new baseline, but it is still executed and verified against a fresh sandbox created from the current host. A verified host-pending candidate is fully replayed and reverified under the project mutation lock before Apply can fast-forward it.
8. Unknown/incomplete impact is treated conservatively as relevant. Relevant Auto/manual-planner peers receive a new background continuation in the same linked ChatGPT conversation and preserve the original user goal.
9. A late bundle that cannot prove a disjoint complete delta chain is ignored rather than replacing the newer adaptation state.
10. Notification delivery is advisory for latency and UX; the OCC checks and current-baseline sandbox verification are authoritative for safety.

## Why not mandatory two-phase AI planning for every change

A compulsory extra model round solely to predict affected files adds latency and cost, and the prediction can still be incomplete. `impact_files` therefore travels with the normal plan and is used as a routing optimization. If a peer is still planning and no forecast is known, Wharness notifies it conservatively. Telemetry may justify a dedicated lightweight preflight forecast later without changing the correctness boundary.

## Consequences

- Equal baseline hashes are a cheap, explicit signal that two requests reasoned over the same managed context.
- Hash mismatch is fail-closed for execution/apply, reducing stale-plan collisions even when file-impact prediction is wrong.
- Selective peer continuation reduces unnecessary ChatGPT traffic for clearly disjoint changes.
- Project-scoped locking closes the Execute/Apply time-of-check/time-of-use gap between Wharness-controlled host mutations.
- Context changes caused by stable Git status/worktree state intentionally invalidate affinity because they can affect patch applicability.
- Existing sessions remain readable; missing plan metadata is recovered from stored request baselines when possible.

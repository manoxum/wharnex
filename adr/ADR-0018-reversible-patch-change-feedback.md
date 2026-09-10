# ADR-0018 — Reversible patch change feedback

## Status

Accepted for Wharness v1.2.31.

## Context

After a successful Apply, the Agent transcript previously told the user that a change happened but did not expose the touched files, a reviewable per-file diff, or a bounded way to undo that exact patch set. A generic Git reset/checkout operation would be too destructive because the project may contain unrelated user work.

## Decision

Wharness derives a presentation-only change summary from the already validated execution plan and stores the plan id, touched paths, additions/deletions and raw unified-diff slices used by the UI. File names navigate to the Editor; delta controls open a focused diff inspector.

Regression is deliberately narrower than general source-control rollback. The backend may reverse only the current successfully applied Protected plan when its host mutation is patch-replayable. It validates patch paths again, runs reverse-check before mutation, applies patches in reverse plan order and marks the session `reverted` only after success. If a later patch fails, Wharness attempts to reapply patches already reversed in that request. Host-replayed Git mutations make the plan non-reversible through this API. A self-evolution plan still in `restart_pending` delegates to the existing transaction rollback snapshot.

A successful Revert retains that exact applied patch batch as a one-step redo candidate. The inverse Restore action forward-replays the retained patches in their original order and rolls back any prefix already replayed if a later patch conflicts. A failed deterministic Restore does not force the old patch or reuse its stale request baseline: Wharnex refreshes the current project context and creates a dedicated `revert_restore` planner request containing the intended reverted batch as reconciliation evidence. The corrected result must then pass the normal Protected verification and Apply flow. Self-evolution restores always use this planner path rather than replaying directly onto the host transaction.

## Consequences

- Undo does not discard unrelated working-tree changes through reset/checkout.
- A stale transcript card cannot silently reverse a newer plan; the UI requires its plan id to equal the current session plan.
- Reversal can legitimately fail after subsequent edits; this is safer than forcing the working tree backward.
- A mistaken Revert can be restored deterministically while the reverted patch still applies; if it no longer does, the user receives a fresh ChatGPT reconciliation request instead of a destructive forced replay.
- Restore-recovery requests use distinct `revert_restore` lineage so their transport bundles can be identified and highlighted separately from generic repair traffic.
- Diff summaries are user-facing evidence only; Policy and the validated execution plan remain authoritative.

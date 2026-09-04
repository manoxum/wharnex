# ADR-0018 — Reversible patch change feedback

## Status

Accepted for Wharness v1.2.31.

## Context

After a successful Apply, the Agent transcript previously told the user that a change happened but did not expose the touched files, a reviewable per-file diff, or a bounded way to undo that exact patch set. A generic Git reset/checkout operation would be too destructive because the project may contain unrelated user work.

## Decision

Wharness derives a presentation-only change summary from the already validated execution plan and stores the plan id, touched paths, additions/deletions and raw unified-diff slices used by the UI. File names navigate to the Editor; delta controls open a focused diff inspector.

Regression is deliberately narrower than general source-control rollback. The backend may reverse only the current successfully applied Protected plan when its host mutation is patch-replayable. It validates patch paths again, runs reverse-check before mutation, applies patches in reverse plan order and marks the session `reverted` only after success. If a later patch fails, Wharness attempts to reapply patches already reversed in that request. Host-replayed Git mutations make the plan non-reversible through this API. A self-evolution plan still in `restart_pending` delegates to the existing transaction rollback snapshot.

## Consequences

- Undo does not discard unrelated working-tree changes through reset/checkout.
- A stale transcript card cannot silently reverse a newer plan; the UI requires its plan id to equal the current session plan.
- Reversal can legitimately fail after subsequent edits; this is safer than forcing the working tree backward.
- Diff summaries are user-facing evidence only; Policy and the validated execution plan remain authoritative.

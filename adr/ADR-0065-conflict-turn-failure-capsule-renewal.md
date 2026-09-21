# ADR-0065 — Dedicated capsule renewal for a failed conflict-resolution turn

- Status: accepted
- Amends: `ADR-0054`
- Evidence: chat `657b6046-2022-4198-98db-dd482f751dcf`, 2026-09-21

## Context

`SoT/AI_PROTOCOL.md` requires that a candidate failing to replay/merge cleanly
enter the dedicated `harness.conflict/v1` path before generic repair is
considered, and prohibits generating another ordinary repair while the
predecessor still fails replay. `ADR-0054` implements the retry half of this
for one specific failure shape: a focused resolution that fails **local
verification** copies its own immutable capsule artifact forward
(`prepareConflictResolutionRetry`) rather than rebuilding it, because CURRENT
has not moved since that capsule was built.

A second failure shape was never given a retry path at all: the planner's own
turn for a conflict-resolution request completing as `failed` with
`retryable=false`. That terminal outcome is handled by the same generic
machinery as any other planner failure (`applyPlannerFailure` /
`retryFailedRequestWithGuidance`), whose "FRESH REQUEST RECOVERY" message is
plain text with no capsule attached at all — the exact "another ordinary
repair" the protocol prohibits. Because `IntegrationConflict` remained active
on the session, the planner correctly kept reporting the same structural gap
(`conflict_capsule_refresh_required`) on every subsequent round, and every
round it received was equally capsule-less: `repair`-kind retries and even a
fresh top-level `standard` request. The session settled into
`planner_guidance_required`, a bucket that asks an operator for guidance that
cannot exist — nothing about the operator's intent had changed, and no free
text the operator could type would supply the missing capsule.

## Decision

`conflict_capsule_refresh_required` (and the `conflict_capsule_stale` /
`conflict_capsule_missing` aliases) is its own closed `FailureKind`,
`domain.FailureKindConflictCapsuleStale`, distinct from the generic
`planner_guidance_required` bucket. A session already persisted with the
generic classification for this same underlying cause is recognized from its
recorded failure text (`sessionHasConflictCapsuleStaleDiagnostic`), the same
compatibility shape `ADR-0054`'s predecessors used for the submodule-write
migration.

Its dedicated recovery, `RenewConflictCapsule`, rebuilds the
`harness.conflict/v1` capsule from the conflict thread's own recorded paths
and sources — never a copy of stale bytes, since the planner named the
capsule itself as stale. BASE and RESULT are re-read at the commits the
thread already owns per path (`ConflictPathSource`, or `GitConflictContext`
for a Git-originated thread); CURRENT is always re-read at the live host
`HEAD`, matching every other capsule builder in the conflict family. Before
any file is read, the recorded path set itself is checked against the live
host via `extendConflictWithLiveDrift` (see the Amendment below) and
extended when the host has moved further out of sync with the same candidate
since the thread's path set was captured — a stale snapshot of *which paths
conflict* is exactly as unanswerable as stale file content. The rebuilt
capsule is sent as a new `conflict`-kind request in the same lineage,
spending the same bounded `ConflictAttempt` budget
(`conflictResolutionExhausted`) as an ordinary conflict round, and is
reachable only through an explicit approved call — consistent with every
other classified infrastructure fault's recovery (`RetryDependencyNetwork`,
`RetryHostDependencyRepair`) — never automatically, since a repeated
mechanical rebuild against an unchanged conflict is exactly the loop those
dedicated actions exist to bound.

`retryFailedRequestWithGuidance`'s existing terminal-kind guard already
refuses to run its generic body for a classified kind outside its narrow
allowlist, so classifying this failure is what stops the prohibited
capsule-less repair from being generated again, independent of the new
recovery being invoked.

## Amendment — path drift is read from Git, never from prose or a patch tool's stdout

Recovering the session above with `RenewConflictCapsule` uncovered a second,
related gap in the same incident, and a first attempt at fixing it was itself
insufficient. The capsule `RenewConflictCapsule` rebuilt still only covered
`services/frontend/src/lib/api.ts`, because it trusted the conflict thread's
own recorded `Paths` as complete. But the host had, between rounds, moved
three more files of the exact same candidate commit out of sync —
`services/frontend/src/components/GitDrawer.tsx`, `GitDrawer.test.tsx` and
`styles.css` — and the planner, correctly reading the live project, kept
reporting `conflict_capsule_refresh_required` against the freshly-rebuilt but
still one-path capsule. Renewing byte content is not the same fix as
widening what the capsule is even allowed to name.

A first version of this amendment tried to learn the new paths by
pattern-matching `git apply --3way`'s own "Applied patch to '<path>' with
conflicts." lines out of a local replay failure's error text. That covers
only the one failure shape that happens to produce that exact stdout, and
does nothing for `RenewConflictCapsule` itself, called directly for a
*planner*-reported failure that carries no such text at all — exactly the
session in Evidence, which is why the first deploy of this amendment did not
close it.

The fix instead asks Git the question directly, the same way `PreflightMerge`
already answers it for scheduling (`sandbox/mergepreflight.go`):
`extendConflictWithLiveDrift` runs `git merge-tree --write-tree --name-only`
between the live host `HEAD` and the conflict's own candidate commit — an
offline, working-tree-free check — and folds any path that comes back
conflicting beyond the thread's recorded `Paths` into it, reusing an
already-known path's `ConflictPathSource` for each new one, since every path
in this check belongs to the one candidate commit the thread already owns,
never a new collision. This one ground-truth check now runs both inside
`refreshConflictCapsule` (so `RenewConflictCapsule` always rebuilds the
*complete* current path set, not just the recorded one) and at the local
replay retry branch, where `conflictNeedsCapsuleExtension` decides between a
full rebuild and `ADR-0054`'s cheaper byte-identical
`prepareConflictResolutionRetry` for a genuinely unchanged path set.

## Consequences

- A conflict-resolution turn that fails at the planner level, not only one
  that fails local verification, now has a retry path that satisfies
  `SoT/AI_PROTOCOL.md`'s "dedicated `harness.conflict/v1` path before generic
  repair" rule.
- A session already stuck in `planner_guidance_required` for this exact cause
  recovers through the same `RenewConflictCapsule` call once the diagnostic
  text is recognized, without a data migration.
- `POST /api/sessions/{id}/conflict-capsule-renew` is the new endpoint;
  `api.renewConflictCapsule` is its frontend client. Surfacing it as an
  attention-center action is left to the UI work that follows this fix.
- A local replay that discovers additional conflicting paths mid-resolution
  no longer resends a capsule the planner already knows is incomplete;
  `ADR-0054`'s byte-identical retry remains the automatic path whenever the
  conflicting path set is genuinely unchanged.

## Verification

`go build ./...` and `go test ./...` pass for `services/backend`, including
`TestExtendConflictWithLiveDriftAddsAPathTheCapsuleNeverAuthorized` (a real
temporary Git repository reproducing the production drift: a candidate
touching two files, replayed against a host that independently diverged on
both, with the conflict thread opened for only one) and
`TestExtendConflictWithLiveDriftLeavesAnUnchangedPathSetAlone` (no drift ⇒ no
path added). The stuck session named in Evidence was recovered by calling the
new endpoint against the running backend after this amendment's deploy.

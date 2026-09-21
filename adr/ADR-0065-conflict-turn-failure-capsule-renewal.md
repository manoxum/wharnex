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
`HEAD`, matching every other capsule builder in the conflict family. The
rebuilt capsule is sent as a new `conflict`-kind request in the same
lineage, spending the same bounded `ConflictAttempt` budget
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

## Amendment — path drift discovered by the replay itself

Recovering the session above with `RenewConflictCapsule` uncovered a second,
related gap in the same incident. The next automatic Apply replayed the
conflict's own candidate commit (`ADR-0054`'s "canonical residual" of every
non-conflicting path) against the host again, and this time `git apply
--3way` itself reported new conflicts on paths the capsule never
authorized — `services/frontend/src/components/GitDrawer.tsx`,
`GitDrawer.test.tsx` and `styles.css` had drifted out of sync with the host
between rounds. That failure is a plain `error`, not one of the two typed
conflict shapes (`pendingChangeSetReplayConflict`,
`pendingIntegrationReplayConflict`) that already carry a parsed path list, so
it fell to the same-request retry branch, which called
`prepareConflictResolutionRetry` — the `ADR-0054` byte-identical resend that
is correct only when the path set has not changed. Sent for a capsule that
authorized one path while three others now failed, the planner reported the
same `conflict_capsule_refresh_required` code again, for the same underlying
reason `RenewConflictCapsule` exists to fix: the capsule was incomplete, not
merely stale.

`extendConflictWithReplayDrift` closes this gap where it occurs. It reads the
new conflicting paths straight out of `git apply --3way`'s own "Applied patch
to '<path>' with conflicts." lines (`parseGitApplyConflictPaths`), and when
any of them are not already in the open conflict's `Paths`, extends the
thread with them — every new path reuses an already-known path's
`ConflictPathSource`, since a replay failure here is the *same* candidate
commit the thread already owns, never a new collision — and calls
`refreshConflictCapsule` to rebuild and resend the full, now-complete
capsule. Only when the replay names no path outside the capsule's authority
does the branch fall through to the original `prepareConflictResolutionRetry`
byte-copy, preserving `ADR-0054`'s behavior for the case it was designed for.

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
new unit coverage for `parseGitApplyConflictPaths`. The stuck session named
in Evidence was recovered by calling the new endpoint directly against the
running backend, then again once the replay-drift amendment above was
deployed.

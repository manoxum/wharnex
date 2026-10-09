# ADR-0096 — Require owned submodule integration completion

## Evidence

The DRCAE soft-delete candidate was verified in Protected execution, but its
backend fast-forward failed with an index-lock creation error. The superproject
merge and admin checkout succeeded. The Engine reported the backend as skipped,
ran host tests against the old checkout, and emitted `host.applied`. The missing
backend regression file was never tested there. This is an incomplete
repository-tree transaction, not a successful code correction.

## Decision

Before host verification, every submodule owned by the candidate must be
reported as advanced to its verified commit or a proven descendant, retaining
the recorded branch identity. A skipped or unreported owned repository blocks
completion. The transaction restores its exact pre-merge superproject and any
submodules it already advanced. Rollback failures are returned alongside the
original diagnostic. Verified branches remain available for recovery, and this
local infrastructure condition does not spend a planner repair round.

Generic reconciliation of unrelated submodules still reports safe skips.
Bounded index-lock retry accepts both Git's `fatal:` and `error:` forms of the
same exact creation failure. Cleanup still requires the engine-owned host
proof in ADR-0092; no planner lock-deletion capability is added.

## Compatibility and validation

No execution wire format changes. Existing repository integration records and
execution approval remain authoritative. A formerly successful partial Apply
now returns a typed host block. Regression tests hold a nested repository lock,
assert rollback and candidate retention, release it and retry the same
candidate; a second case proves transient contention can clear locally.

Integration proves project source state only. Runtime rollout and acceptance
checks remain separate evidence and must not be claimed from mock tests or
the `applied` state alone.

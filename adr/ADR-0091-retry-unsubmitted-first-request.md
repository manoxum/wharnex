# ADR-0091 — Recover an unsubmitted first ChatGPT request

Status: Accepted
Date: 2026-10-05

A failed first upload leaves a durable input archive but no conversation URL.
After Desktop restart, manual resume previously required that absent URL and
could not reach full-archive delivery.

The explicit resume action routes an unbound request to the existing persisted
archive retry. Exact local session ownership, latest pending request, absence
of binding/recovery candidates, and absence of response observation or
any write tasks are prerequisites. Failed writes can have ambiguous dispatch;
they also reject this unbound recovery. Missing evidence rejects delivery.
Only the exact ChatGPT home URL is eligible; caller-supplied arbitrary URLs
remain forbidden. Existing bound conversations keep their recovery guards.

The original archive is uploaded unchanged. Submission must yield a concrete
conversation URL, persist that binding, and enqueue durable response supervision.
Restart alone never authorizes replay. No protocol/archive migration is needed;
legacy persisted input artifacts remain readable at their compatibility boundary.

Regression tests cover a restarted first delivery, duplicate/ambiguous evidence,
and the actual UI resume action. The UI change touches behavior only and extracts
the recovery concern from its oversized legacy component; styling is unchanged.

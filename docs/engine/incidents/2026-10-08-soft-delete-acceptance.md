# Real-case learning: soft delete and runtime acceptance

Status: the Realtime/detail query correction was integrated with host verification
at 16:34:02 UTC. The operator confirmed that behavior, then identified deleted
rows still present in reports. Central PostgreSQL RLS correction and live
DB/API acceptance of the expanded scope are pending. Do not classify this incident
as resolved from source changes, mocked tests, a build, or `host.applied` alone.

## Observed failure

DRCAE admin continued showing visits with `status=-1` in Realtime and allowed
their direct detail URLs. The earlier Protected candidate contained a backend
fix, but host integration skipped that owned backend submodule after Git emitted
`error: Unable to create ... index.lock: File exists`. The root and admin moved;
host tests used the older backend and the engine nevertheless emitted success.
The durable event history exposed the discrepancy.

## Engine changes proved by regression

- An owned submodule skip blocks verification and success. The engine measures
  the actual commit and branch, rolls back the transaction, and retains the
  verified candidate for retry. A real nested-repository lock reproduced the
  failure; the regression now proves rollback and successful retry of the same
  candidate after contention clears. See ADR-0096.
- Exact index-lock retry recognizes both `error:` and `fatal:` without widening
  the host-only cleanup proof or matching a foreign/private index.
- Planner instructions distinguish prepared changes, Protected tests, host
  integration and observed runtime acceptance, including pending evidence.
- A separate `@file` failure discarded `ProjectFiles`, compared archive-prefixed
  selections with project-relative paths, and lost selection on refresh. Channel
  regressions now prove explicit and inline references survive content refresh.
  Inline references come only from the durable operator message and intersect
  the eligible manifest, preserving the file authorization boundary.

## Host recovery observed

The corrected engine recovered the same pending candidate on startup. Durable
events report `services/drcae-backend` updated with no skips, then successful
host verification before `host.applied` at 16:34:02 UTC. The measured checkout
HEAD is `4c8302127a4782949285d7de74695cbf11fe9bd7`; both new regression files
exist there. The next runtime-acceptance request was submitted once in the same
conversation at 16:35:40 UTC. This source-state evidence does not prove the
running DRCAE service has loaded the change.

## Runtime acceptance still required

The operator identified the real startup command as
`docker compose --env-file .env.main up --build -d`. The file name identifies
the composition; its credentials and environment values are not evidence to
publish. Wharnex must obtain an approved execution plan from GPT and call the
running service API to demonstrate:

1. Deleted visits are absent from Realtime, including filtering before limits.
2. A deleted visit cannot be read through its direct detail entry point.
3. An active visit remains accessible.
4. The tested container uses the integrated source/image, rather than an older
   process that happens to share the same project checkout.

Record command/API outcomes and actual acceptance evidence before closing this
case. Three measured lessons were persisted in the DRCAE operational catalog
(revision 8) under `execution_repair`, `verification` and `protocol_transport`;
each explicitly retains the pending runtime/RLS acceptance. This is durable
operational knowledge, not model fine-tuning. Keep DRCAE business rules separate
from reusable Wharnex evolution evidence.

## Expanded scope and transport visibility

The operator reported that per-query filtering left other reports exposed and
requested central RLS for the configured application role (`DBAPP_USER_NAME`,
locally `drcae_app`). Request `req_20261008T164615_749e937d054dae87` was submitted
in the same conversation at 16:46:40 UTC. Its acceptance requires actual
application-role reads across eligible tables and reports, plus preserved writes
and maintenance behavior. The earlier runtime API workflow was received but not executed. The RLS catalog
workflow was approved in the UI and ran at 16:55:27 UTC; Compose failed with
`services.gateway conflicts with imported resource` before any PostgreSQL probe.
The engine durably recorded the failed execution and submitted continuation
`req_20261008T165529_67647b0aab3c3fdb` once. Neither workflow provides successful
runtime acceptance.

API-submitted operator prompts were missing from the local transcript because
only the renderer wrote its message list. Durable request identity, protected
backend transcript entries, idempotent append and live ownership-scoped
notifications now have regressions. The live client reads authoritative items
after notification because audit frames deliberately bound/redact text.

## Verification environment

Inherited runtime bridges and long temporary paths can invalidate container
tests: a host bridge cannot see container-private `/tmp`, Unix sockets have
bounded path lengths, and a temp directory below this repository inherits its
Git ancestry. Use a short, host-shared temporary directory outside the checkout
and isolated bridge settings for the test process. Do not weaken assertions to
hide these environmental failures.

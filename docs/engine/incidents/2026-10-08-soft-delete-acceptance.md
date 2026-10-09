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

## Recovery after interrupted delivery (2026-10-09)

The continuation ZIP completed download at 17:00:31 on October 8, then the
machine interrupted backend delivery. On restart an unrelated project window
converted a non-terminal routing error to a fulfilled promise and the inbox
ACK deleted the unimported ZIP. The backend still reported `workflow_pending`
and had no corresponding output artifact or recorded plan.

The delivery regression reproduced that false ACK. The extracted inbox boundary
now retains/NACKs routing failures; only a successful owning backend import
allows ACK. Nineteen focused tests and frontend typecheck/scoped lint/build
passed. The three original API prompts were restored by idempotent append,
proving one complete entry per request even after a repeated append.

After frontend activation and a coordinated Desktop reload, an AWAIT-only retry
recovered the same 16,876-byte ZIP at 08:37:55. The engine imported its Docker
label-discovery workflow, awaiting consent; no operator prompt was repeated.
The measured lesson was persisted as `2026-10-09-cross-project-bundle-ack`.
Backend full vet, test and race gates passed on the resumed run. The frontend
full suite reported 42 failed files / 63 failed tests. Comparison against fixed
pre-change commit `6bbfd73a` reproduced 59 of those failures; all four differing
assertions passed on a subsequent focused run. The variable knowledge-explorer
assertion also failed identically in isolated current and pre-change runs.
Existing suite debt was not relaxed or rewritten; the 19 focused tests for the
changed delivery/transcript behavior remain green.

## Current RLS decision boundary

Docker label discovery ran successfully at 08:39:35 on October 9, after approval
recorded in the Wharnex UI. The engine sent the results once in continuation
`req_20261009T083938_dc922438db26c173`. Its returned plan
`plan_20261009T083938_rls_backend_catalog_probe` is a typed, exact-container
Prisma catalog/aggregate probe for `drcae-backend-1`, with no DDL/DML or rollout.
The operator approved it in the UI at 08:56:35. It ran and failed with Prisma
`P2010` before returning any catalog/identity evidence; its error wrapper emitted
only that generic code, so the exact SQL cause is still unknown. The engine
recorded the failed execution and prepared continuation
`req_20261009T085637_6127f6b05cd46ade`. No RLS migration or database/report
acceptance is proved. A subsequent diagnostic should preserve a bounded stage
identifier and SQLSTATE rather than hide the cause behind a client wrapper code.

## Measured database posture (2026-10-09 09:03 UTC)

The operator approved the staged catalog probe in the Wharnex UI. The actual
963-ms execution returned full JSON with 52 eligible integer-status tables,
all with RLS disabled, and no policies. Prisma connected as `drcae`, a
superuser with `BYPASSRLS`; the configured target role `drcae_app` did not exist.
Aggregate reads exposed 14 deleted rows: three in `app_device` and eleven in
`inspection`. These are measured prerequisites for the correction, not
acceptance of it.

The independent dependent-view stage failed with SQLSTATE `42P10`: the
`SELECT DISTINCT` query ordered by expressions outside its select list. The
other stages and all 52 aggregate counts survived. Process exit zero and
`workflow.completed` describe diagnostic transport/execution; they do not
mean every diagnostic stage passed or that RLS was corrected. The engine sent
the complete result in continuation `req_20261009T090351_175c046e33fa46f4`
at 09:04:20 without another Main Request. The staged-diagnostic lesson was
persisted in the operational knowledge catalog (revision 10). Provisioning
the application role, using it in the real connection, policies and real API
acceptance remain pending.

## Diagnostic protocol regression

The shared planner delivery guidance now requires bounded stage/native-code
evidence and checking partial failures before claiming success. Its consumer
and provider contract regression failed before implementation and passed
afterwards. Guidance moved into the delivery domain, retaining the existing
planner composition entry point. Full backend vet, test and race gates passed
(exit zero, 184 log lines); file limits and scoped whitespace checks passed.
No wire fields or execution authority changed. The running backend has not
yet been replaced to load this additional guidance; durable operational
knowledge revision 10 is already available for subsequent request bundles.

The next GPT plan tests RLS semantics, including soft-delete `RETURNING`, in
a network-disabled disposable PostgreSQL 17 container, plus the corrected
read-only view catalog query. It awaits its own exact informed approval and
performs no DDL in the DRCAE database.

## Disposable semantic test rejected the first RLS design

The operator approved the next exact plan at 09:17:00. The corrected live
view query returned zero dependent views. The isolated PostgreSQL 17 test
passed application identity, deleted-row read filtering and NULL visibility,
then failed `UPDATE status=-1 RETURNING` with a row-level-security error
(exit 3). Later assertions did not run and must not be reported as passing.
No DRCAE DDL or business-data write occurred. Wharnex recorded the failed
execution and prepared continuation `req_20261009T091713_38a6f4aceeb10275`
with revision-10 operational knowledge. The design must preserve the actual
write/RETURNING contract before any live migration; no runtime acceptance
is claimed from this failed disposable test.

## Workflow request correlation and unrelated context changes

A public `ApproveDebug` regression reproduced the workflow recorder assigning
`plan_id` to `request_id` in both v1 and v2 paths. Callers now pass the executing
plan's actual request ID to the extracted observation writer. Both public paths
advance to a different continuation while retaining the original execution's
request identity in the ledger; existing history remains immutable and is
projected through plan identity by the frontend compatibility work.

The RLS response at 09:27:36 was rejected after the parallel smoke fixture
changed the same project. Input archive comparison showed only `EXPORTS.md`,
`VERSION` and the fixture file changed; all nine declared read files were
unchanged. A public request/context-refresh/bundle-ingestion regression
reproduced the unnecessary stale-command rejection. The extracted workflow
baseline guard now permits only patch-free scoped diagnostics without project
impact, with complete retained/current snapshots and matching hashes for every
concrete read/barrier dependency. Missing/changed inputs, patches and impact
refuse this shortcut. The regression preserves `debug_approval_required` and
proves no execution authority is granted by baseline adaptation.

Focused race tests passed for both domains. The intermediate full race run
encountered the existing `TestReArchivingDisposesNothing` temporary Git cleanup
race, independently reproduced in the pre-change baseline log; no assertion was
relaxed. Final full gates and image activation remain tracked separately.

The automatic refreshed request `req_20261009T092752_14ee6f33821fa80d` was approved
in the UI and tested the next disposable design. It also failed with a new-row
RLS policy violation (exit 3), preserving the real database. Wharnex prepared
continuation `req_20261009T093459_2d0b35171ce86857`; source correction and real
application-role/API acceptance are still pending.

## Restricted bridge proved in isolation

The next exact disposable plan was approved in the UI and completed at
09:46:22 (6,762 ms, exit zero, PostgreSQL 17.11). Its table-specific restricted
SECURITY DEFINER bridge passed soft delete and idempotence while base-table
reads still excluded deleted rows. Ordinary writes/RETURNING, joins, aggregate
filtering, tenant-policy composition, minimal tombstone shape, maintenance
visibility, explicit privileges and fixed search_path assertions passed.
The test used synthetic roles/data and SET ROLE; actual application login and
real service/API behavior are still separate acceptance requirements.
Wharnex prepared continuation `req_20261009T094623_e547ff7aad1a15fb` to author
the source correction. No real migration or rollout has occurred.

## Final engine gates and activation

The final backend source passed full vet, test and race gates (190 log lines,
exit zero), focused public regressions/race, size/domain checks and scoped diff
checks. Image `fb897597c6633a29a94da3060c3e3faf406a0adb91c44cbd753c999a1088e962`
was built successfully. Another environment action activated that exact image
at 09:56:02; this supervisor detected it rather than restarting it again.
At 09:57:36 Docker reported healthy, the API returned 200 and the existing
DRCAE request/session resumed `workflow_pending` without a repeated prompt.
The previous image remains retained for rollback. These facts prove Wharnex
engine activation; they do not prove any DRCAE migration or live acceptance.

### Production RLS review and nested Node hydration (2026-10-09)

The original Supervisor captured response094623 at 10:08; the source plan was approved in the UI at 10:15:46. Protected patch and ShellCheck passed, but backend verification stopped before build: `pnpm --dir services/drcae-backend run be:build` selected a nested package while dependency acquisition incorrectly installed at `/workspace`, which has no package manifest. Execution failed as `sandbox_dependency_acquisition`; no host integration or database rollout was established. An attempted unexecuted-plan adjustment was correctly refused because the approved execution had started; it created no new request.

The engine regression reproduced missing nested dependency copying, then passed after sharing the bounded directory resolution between copying and nearest-lockfile acquisition. A real pnpm script executed through LocalRunner's actual isolated dependency preparation; additional tests cover selector forms, cwd-relative resolution, script arguments, malformed/duplicate/traversing paths, and a symlink escape even when Plug'n'Play exists. This is engine infrastructure evidence, not DRCAE source or database acceptance. Full gates and activation remain pending until separately recorded.

Source review is retained in the chat's operational knowledge revision14. Required follow-up includes fail-closed startup when DBAPP_USER_NAME is missing, preserving the rejected-device response status, automated tests of the delivered provisioning SQL and consumers, deletion timestamp/delta semantics, and indirect table-owner membership. The isolated SECURITY DEFINER prototype used different SQL and cannot replace these checks. The actual PostgreSQL app login and report/Realtime/deleted-detail/active/write/app-sync API acceptance remain pending.


### Confirmed engine activation and production revision dispatch

The nested pnpm directory and explicit failed-Protected adjustment fixes passed the complete Go vet, test and race suites (`.harness/logs/soft-delete-node-adjustment-final-gates.log`). Backend image `5b282f56cb873dfae84042423f0f7e0711128d047075fc7637dff293e637f9cc` was activated backend-only after coordinated checks; the API recovered healthy and request/session state survived. The review API generated derived request `req_20261009T104515_e000956ab04737f2` with source parent094623 and original root164615. Generation alone did not dispatch transport: no task existed after two minutes. One normal deduplicated BOT_WRITE then uploaded the request ZIP, validated high effort and submitted at 10:48:47 UTC. Its DONE receipt and AWAIT_RESPONSE prove dispatch/supervision, not source application or RLS acceptance. Do not submit the old failed candidate again.

A proposed explicit post-integration observation API carries matching source integration receipts into the same Main Request, resets source consent and requires initial runtime observation/prerequisite collection rather than an unsupported success answer. Public tests cover Main lineage, receipt guards, concurrent/stale requests, ZIP ingestion and direct provider adapters. This later improvement remains pending complete gates and coordinated activation; no real DRCAE rollout is authorized by it. An external Wharnex self-evolution snapshot captured this supervisor's unfinished source before its initial compile gate and failed on a pointer/value mismatch. That defect was corrected; the failed host build must remain a failure in the ledger. Never treat a shared working tree or a generated image as validated source before its final gates complete.

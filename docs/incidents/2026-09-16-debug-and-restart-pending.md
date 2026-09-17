# Debug evidence and stale restart-pending incidents — 2026-09-16

## Scope

- Chat `d851c990-c5ae-444f-9e2b-075337d40b50`, context `659d889abcad7961684029f89ce511db7c520b7c932b7dd9c409c2733fa9bb53`.
- Chat `b6e7932c-0305-4542-a06d-362f12b38fd1`, context `56aa664d501a79b90fc103d5a7a8f8af5d24d1c4565d32b88abdfec12d77ef4a`.

## Incident 1: Debug could not answer from runtime history

The operator enabled Debug and asked for the local plan-execution success/failure rate. The request was accepted at `18:28:40Z`, but the response at `18:33:22Z` terminated as `failed` with `reason_code=runtime_execution_history_unavailable` and `failure_kind=planner_guidance_required`. No workflow, command, or debug observation ran.

The immediate cause was missing evidence. The root cause was a protocol capability gap: the host debug allowlist contained Git/toolchain/system probes, but no narrow operation could read execution aggregates from the durable event ledger. A stronger prompt alone could not repair this because every available argv was incapable of answering the question.

`harness.debug/v1` now has the closed engine-owned `project_execution_summary` query. It returns aggregate project counts without exposing command output, raw events, SQL, secrets or arbitrary paths. The planner is explicitly instructed to use it before returning a missing-history terminal failure.

## Incident 2: duplicate Apply destroyed restart recovery

The plan `plan_fix_sandbox_preparation_timeout_20260916` verified successfully. Host integration and build completed, version `v1.2.59.1` was recorded, and transaction `20260916T174825-533a3c8d7b23` entered `restart_pending` at `17:52:19Z`.

At `17:53:04Z` the same plan entered `self_evolution.transaction_started` and `host.apply_started` again. It attempted to merge the already-consumed branch `whx/req_20260916T172109_7f6f95a01cb29973`, failed with `not something we can merge`, marked the transaction aborted and retained the session label as `restart_pending`. Later restart confirmation failed because the transaction directory was no longer pending/present.

The root race was that `ApplyToHost` loaded the session before acquiring its project mutation lock. The second caller waited with a stale `verified` snapshot and continued after the first caller had atomically consumed and deleted the integration branch. Cleanup then treated the joined pending transaction as newly created and finalized the prior batch.

Host Apply now reloads durable session state under the project lock. A duplicate sees no unconsumed candidate and exits before any host or transaction side effect. Pre-mutation extension cleanup also retains the prior transaction and removes only newly appended membership. Finally, a later healthy runtime restart reconciles older activation flags when their successful host Apply timestamp predates that restart; this repairs the historical stranded session without fabricating an Apply or deleting audit history.

## Incident 3: Debug cleanup bundled discovery and destruction

For context `deaa515b44d9ddd9b6f29f4b2b59580adf97ecf3fe607b1e7e1bfc5cd019c31a`, the cleanup plan `plan_20260916T222945_minio_bundle_cleanup_3d` was approved as `harness.debug/v1 access=modify`. It contained one large `node -e` payload that tried to discover a local backend, select all bundle artifacts older than three days, delete them and verify the result. It failed immediately with `connect ECONNREFUSED 127.0.0.1:8888`; no inventory was produced and no deletion occurred. Its continuation nevertheless proposed another destructive host plan.

The root cause was architectural: generic model-authored argv provided no seam between discovery and mutation. An approval could not name or freeze the affected objects, and the inline program hid both target selection and destructive action from the normal command-level review.

ADR-0060 retires host-modifying debug workflows. New `harness.interactive/v1` workflows are observation-only and may use a bounded 24-round evidence budget. The Policy now denies inline programs in model plans. Future cleanup/deployment/remote capabilities must be typed modules that own candidate inventory, immutable manifests, preflight, scoped approval, drift revalidation and postcondition verification.

## Reusable recognition rules

- `runtime_execution_history_unavailable` after Debug was enabled, with no `workflow.started`, indicates a protocol capability gap, not a source failure. Use an engine-owned aggregate query; never grant raw database/log access.
- A second `host.apply_started` for one already successful plan is a duplicate-delivery/concurrency defect. It must not become a bundle repair request.
- `restart_pending` is truthful only while activation evidence remains actionable. A later healthy runtime restart is sufficient temporal evidence to clear older pending activations that were already applied to the host.
- A pre-mutation failure while extending a pending self-evolution batch must preserve the original rollback baseline, batch lock and transaction directory.

## Regression coverage

- Protocol accepts only the named execution-summary query on the host target and allows it without a dummy command.
- The query test proves counts come from project-scoped durable ledger events.
- A deterministic concurrent Apply test reproduces the deleted-branch error and proves the second caller stops at the consumed-candidate guard.
- Transaction coverage proves a failed pre-mutation extension can remove its own membership while preserving the original pending batch.
- Reconciliation coverage proves a later healthy restart clears an older stranded activation and emits timestamped audit evidence.

## 2026-09-17 live reasoning-control calibration

The rebuilt Electron Desktop was started with `WHARNESS_BEHAVIOR_PROBE=1`. Captured authenticated composer surfaces established one visible composer surface, one effort pill, and the observed Portuguese labels `Instantâneo`, `Médio` and `Elevada`; the browser behavior document therefore exposes only those three closed levels. The selector is composer-scoped, not a global menu scrape, and every cycle is verified before submit.

An end-to-end Markdown translation was then deliberately run as a minimal live transport check. The Worker loaded the trusted ChatGPT origin but failed before reasoning enforcement: ChatGPT never acknowledged the ZIP upload after the bounded retry policy (`cat_cd5c47498f4b659788c8`, terminal `FAILED`). This is transport evidence, not a reasoning-selection success; no arbitrary DOM evaluation, response-prose read, or unbounded retry was used to bypass it. The failure remains actionable separately as `ChatGPT upload failed after 5 attempts`.

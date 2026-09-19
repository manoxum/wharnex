# Error Model SoT

Errors crossing the HTTP boundary use:

```json
{"error":{"code":"stable_code","message":"human readable message"}}
```

Do not return raw secrets, environment dumps, provider authorization headers, or full internal stack traces.

## Verification failure attribution

A verification command is usually a whole suite: `go test ./...` puts every package behind one exit code. Its exit status therefore answers "did anything fail?", never "did this change break anything?", and the two questions have different answers in any repository whose gates are not already green.

Wharnex MUST answer the second question by running the same command against the unmodified baseline and comparing the two runs failure by failure, not byte by byte. Comparison MUST decompose the output into individual failures for every diagnostic family it understands — at minimum Go test names, Go package failures (including a package that fails to build, which emits no per-test failure line at all) and TypeScript diagnostics. Output in no recognised family stays on the strict whole-output comparison and is treated as a regression: guessing would let a real one through.

- When the patched run introduces no failure the baseline did not already report, the command is a pre-existing failure. It MUST NOT fail the candidate, and it is recorded as a warning.
- When it does introduce failures, the candidate fails — but the diagnostic that reaches the repair round MUST name which failures the change introduced and which were already failing, and MUST state that the pre-existing ones are not to be fixed.

That last rule is load bearing rather than cosmetic. Handed an undifferentiated suite log, a planner has no way to tell its own breakage from the repository's, and the cheapest way to make a gate green is to change the thing being verified: relax the assertion, delete the test, revert the symbol it expects. That destroys work that was already accepted, and it passes every structural check on the way through.

## A gate the host verification environment cannot run yields no verdict

Post-merge verification re-runs a plan's own gates against the real merged host
tree. Those gates were authored and verified in the Protected runner image,
which carries the project build toolchain; the host re-run happens in Wharnex's
own control container, whose inventory is narrower. When that container cannot
run a gate **at all**, the run answers nothing about the merge, and treating
"no verdict" as "failed" discards a verified candidate over an infrastructure
fault (see `adr/ADR-0043`).

Such a gate MUST be recorded as unverified on host and integration MUST
continue:

- The evidence is the failing command's own recorded output — exit 127 with a
  missing-executable marker, or a build driver reporting that the requested mode
  is unavailable (cgo disabled, no C compiler, an instrumentation mode this
  platform does not support). Wharnex never consults an inventory it maintains
  itself.
- Each such gate publishes `integration.verification_unsupported` with its argv,
  cwd, exit code, reason and diagnostic, and the terminal `host.applied` event
  carries `unverified_host_gates` naming every gate the Apply went without.
- This is not a gate relaxed to make it pass. The gate ran in full against this
  exact candidate in the Protected runner; only the host-side corroboration is
  missing, and its absence is reported rather than absorbed.
- The classification is narrow and fails closed. An ordinary test failure, a
  detected data race, a compile error in the merged result, or a runner
  error (timeout, cancellation) remains an ordinary post-merge failure that
  reverts the host to its exact pre-merge commit.

Skipping is a fallback, never the goal. The control container's toolchain MUST
be kept wide enough to actually run the gates the hosted projects declare;
observing this event repeatedly for the same gate is a signal to widen it.

## A change bundle must be able to deliver what it declares

A `change` bundle that declares an `impact_files` entry the patch does not write
**and** that does not exist in the project is structurally incomplete: it
promises a file that will exist nowhere, so the definition its own patch
references cannot resolve. It MUST be rejected at ingestion — before Policy and
before sandbox verification — publishing `bundle.incomplete_impact_files` with
the offending paths (see `adr/ADR-0045`).

Both conditions are required. `impact_files` stays a forecast: over-declaring a
file that already exists is ordinary planner imprecision and is accepted. The
check MUST fail open, treating any path it cannot resolve as deliverable,
because rejecting a legitimate change is worse than missing a detection.

The reason for catching it here is the diagnostic, not only the cost. Discovered
by the compiler instead, the failure reaches the planner as `undefined: <symbol>`
— which invites re-reading source that was never at fault rather than shipping
the file the plan already promised. Measured across the archived bundles, two
incomplete bundles produced exactly that outcome and no complete bundle was
misread as incomplete.

## Durable execution-error ledger

Failed executions routed through the canonical execution failure path are persisted in the structured `harness_execution_errors` table in addition to the append-only audit stream. Each failed `ExecutionResult` records the session/chat identity, root/request/plan correlation, execution stage, sanitized error and cause, normalized `FailureKind`, the first failed process exit code when one exists, and the specific failed command or interactive-operation logs. Records start with status `open` and are returned newest-first by `GET /api/sessions/{id}/execution-errors`.

The ledger is an operational error-history surface, not a replacement for `harness_events`. Before database persistence, error text, command arguments, working directories, stdout/stderr, and interactive output are passed through the same bounded secret-redaction rule used by the audit bus. Raw credentials or unbounded command output MUST NOT be written to this table.

When a successful execution belongs to a GPT correction lineage (`repair`, `revert_restore`, `improvement`, or `conflict`), all still-open error rows for the same `root_request_id` are marked `resolved`. The resolution stores the correction request ID, plan ID, sanitized plan summary, and sanitized commit message as the structured GPT solution, together with `resolved_at`. This root-request correlation preserves the complete failure chain when more than one repair attempt failed before the final correction succeeded.

Archive compaction may remove archived rows from `harness_events`; it does not remove structured execution-error rows. A full session-store clear truncates the error ledger with the other durable session data.

## Session failure classification (`FailureKind`)

A terminal session failure MAY carry `failure_kind`: Wharness's own closed-set classification (`domain.FailureKind*`), always derived by Wharness itself from a local/sandbox error or a structured planner outcome — never copied verbatim from planner-supplied text. Frontend recovery affordances MUST key off this field, never off error-message substrings.

| `failure_kind` | Meaning | Recovery |
| --- | --- | --- |
| `offline_go_module_cache` | Neither the Wharnex-owned private Go cache for this project nor the Wharnex runtime's own compatibility cache can satisfy the build list under `GOPROXY=off`. That private cache is keyed on the canonical project and MUST stay so even when the run executes an extracted immutable base (`adr/ADR-0045`); the compatibility fallback reads the Wharnex runtime's GOMODCACHE, which is the operator's machine only in development mode. | Human-approved, narrowly scoped network grant for the eligible Go commands (`RetryDependencyNetwork`; see `SANDBOX_MODEL.md`). |
| `sandbox_preparation_timeout` | A Protected command exhausted its declared budget while Wharnex was still preparing the isolated run (for example copying execution-only `node_modules`, hydrating Go dependencies, or checking Docker) before the requested process started. | Inspect local filesystem/dependency preparation and retry with the environment corrected or a suitable command budget. Never start a GPT source-repair round: the requested source process has not run. |
| `host_dependency_state` | Host-only npm/node dependency defect discovered after Protected verification already passed (e.g. the npm optional-dependency bug, npm/cli#4828). | Fixed, human-approved reinstall recipe run directly on host (`RetryHostDependencyRepair`; see `SANDBOX_MODEL.md`). |
| `host_build_dependency_network` | A host build failed while a package manager was fetching dependencies over the network — a DNS answer that never came, a refused or reset connection, a registry timeout. Derived from real command output and only when that output also shows a fetch in progress, so a project's own network test failing is never misread as this. | Wharnex retries the Apply itself, bounded, with backoff, publishing `integration.network_retry`. The candidate is not implicated: the identical bytes build once the network answers, so this MUST NOT spend a planner round. If the retries are exhausted the candidate is retained and the operator retries Apply after the network recovers. |
| `host_build_toolchain_mismatch` | Host's own toolchain (e.g. Node running a self-evolution build) can't satisfy a pinned dependency's engine requirement. | None — no source patch changes the host's installed runtime. Manual host upgrade only. |
| `self_evolution_transaction_busy` | A self-evolution transaction owns the activation lock. Either another batch is genuinely running, or one is parked in a fail-closed phase (for example `rollback_failed`, where rollback found live bytes that genuinely diverge from its captured source backup) and holds the lock until a human acts. A host preservation commit containing the exact captured existence, mode and bytes is not divergence and MUST roll back automatically. The failure is infrastructure state, never a defect in the generated change. | Retry Apply once a running batch clears. A genuinely divergent fail-closed transaction does not clear on its own: the refusal names the phase, the transaction, the plan that left it and the recorded cause, and `GET /api/self-evolution/block` reports the same. After performing the recovery it describes, the operator releases it explicitly by naming it (`POST /api/self-evolution/block/release`); the transaction directory is kept as evidence. |
| `stale_host_baseline` | A retained legacy candidate could not be safely replayed/reverified on the current host baseline. | Explicit human retry/review of the retained candidate. |
| `host_integration_race` | Repeated compare-and-swap races committing an already-verified candidate. | Retry Apply — this is host concurrency, not a model/source defect. |
| `execution_context_canceled` | A sandbox/host command was interrupted by request cancellation. | Not evidence the generated source is defective; safe to resume/retry. |
| `remote_input_transport` | The request ended because the Desktop/remote ChatGPT transport or returned bundle could not be completed or validated. | Retry the original task as a fresh request from current context; do not ask GPT to repair project source merely because transport failed. |
| `submodule_write` | Bundle ingestion proved that a patch targets a registered submodule which cannot join the repository-tree transaction, most commonly because its checkout is not initialized. Initialized submodules are versioned as nested candidates and do not produce this failure. | Terminal for this request and never a source-repair round. Initialize the named submodule or repair its local Git checkout, then repeat the request. |
| `sandbox_resource_exhausted` | A Protected command failed because the machine ran out of disk, memory or file descriptors mid-run (for example a linker reporting `no space left on device` during a race-enabled build). Derived from real command output, never from planner text. | Free host resources or narrow the verification set, then retry the retained candidate. The generated source is not implicated and rewriting it cannot help. |
| `artifact_storage_full` | The local artifact object store refused a write for lack of space (`XMinioStorageFull` or equivalent). | Wharnex first runs bounded expired-artifact cleanup and retries the write once. If capacity remains exhausted, new request preparation stops in durable human-attention state without consuming repeated provider-task attempts; free object-store/host disk space or lower retention, then explicitly retry. Response archival remains bookkeeping: a response bundle already retained in memory may continue through validation/execution with `artifact.persist_degraded`. |
| `host_working_state_blocked` | Wharnex refused to integrate because the host working tree is in a state where committing on top of it would damage the operator's own uncommitted work: an unfinished merge/rebase/cherry-pick/am, unresolved conflict paths, a locked repository index (another Git process, or a crashed one's leftover `index.lock`), or a change that moves the recorded commit of a submodule holding uncommitted content (see `adr/ADR-0039`). | The operator's own action, named in the failure text and its `host.apply_blocked` event: finish or abort the operation, resolve the paths, commit/stash the work inside the submodule, or clear the named lock. Wharnex never deletes a lock itself: a lock a live process still holds is corrupted by removal, and only the operator can tell live contention from a crash leftover, so the refusal reports the lock's age and names the file. The verified candidate is retained; Apply then succeeds unchanged. |
| `planner_guidance_required` | The current planner outcome explicitly set `retryable=false` and does not map to a dedicated local/infrastructure recovery. Sending identical evidence would deterministically repeat the same blocker; `missing_primary_build_failure` is one example. | Collect non-empty bounded evidence or guidance from the operator, preserving multi-line diagnostics, then create a fresh correlated GPT request carrying the original failure plus that new information. |

None of these classifications consume an automatic ChatGPT source-repair round. `planner_guidance_required` may start a manual GPT round only after the operator supplies new evidence; the remaining kinds use their dedicated infrastructure, lifecycle, host, or transport recovery.

Host Apply is local-first and fail-closed for planner escalation. An Apply error MAY start a bounded GPT repair only when the integration engine explicitly marked it as a candidate defect after completing its applicable local rollback/recovery. State preconditions, an already-active planner/repair turn, transaction coordination, Git/persistence plumbing and unclassified local failures retain the verified candidate and MUST NOT create another request. This is a closed opt-in boundary: the absence of a known infrastructure `failure_kind` is not, by itself, evidence that GPT can repair the failure. Host build output proving an unavailable lifecycle capability (including an unsupported `flock` option under BusyBox) is `host_build_toolchain_mismatch` and remains local.

Staging the merged candidate is an explicit exception, and MUST be marked as a candidate defect. Staging runs entirely inside an isolated workspace and ends before the first host write, so a staging failure cannot have damaged the host or left a transaction half-owned; what it reports is a concrete divergence between the verified candidate and the project, which is precisely what a planner round answers. Leaving it unmarked is the failure mode this rule exists to forbid: a verified bundle then sits on an error that no recovery path owns, the chat shows the text once, and the request waits for a human who has no reason to know it is waiting. Escalation MUST still respect the effort budget, and MUST publish `integration.staging_failed` with the underlying cause.

An automatic escalation MUST NOT require human confirmation while the session's effort budget still has attempts. Wharnex dispatches the correction request itself and stops for a human only when that budget is spent, or when the collision is `structural` — binary content or a file mode disagreement, where no patch can express the answer and a round would be spent proving it. Every escalation decision, in both directions, MUST publish `integration.escalation_decided` with `automatic`, `complexity` and the reason.

## Auxiliary-payload failures MUST NOT invalidate an executable payload

A response bundle carries a verified executable result plus auxiliary material: the archived copy of the bundle itself and the project-knowledge candidate with its cumulative summary. A defect in the auxiliary material MUST NOT reject the bundle.

- Artifact archival failure publishes `artifact.persist_degraded` and ingestion continues. Only the archived copy is missing.
- Knowledge staging failure publishes `knowledge.stage_skipped` with a `reason` and ingestion continues. `concurrent_catalog_revision` means a peer chat advanced the catalog while this request was in flight — routine, self-correcting on the next round, and never a planner defect. `invalid_knowledge_payload` means the returned catalog was structurally wrong.

This rule exists because both failures were observed discarding a complete, verified change over bookkeeping that is committed separately and later.

## Repairable failures MUST name their root cause

A missing executable (exit 127 for a binary absent from the runner image) is repairable — the planner can pick another tool — but only when the repair request says so. The repair prompt MUST identify the missing executable explicitly instead of handing over raw output, which invites re-reading project source that was never at fault. The environment manifest (`SoT/SANDBOX_MODEL.md`) publishes the installed inventory so this condition should not arise at all.

Sandbox execution failures without one of these classifications are repairable planner failures. Wharness attempts their bounded GPT repair automatically and retains a manual GPT repair fallback with optional operator guidance after automatic preparation, transport, or attempt exhaustion fails. Host Apply uses the stricter explicit candidate-defect boundary above.

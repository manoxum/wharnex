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

## Session failure classification (`FailureKind`)

A terminal session failure MAY carry `failure_kind`: Wharness's own closed-set classification (`domain.FailureKind*`), always derived by Wharness itself from a local/sandbox error or a planner turn's reason code — never copied verbatim from planner-supplied text. Frontend recovery affordances MUST key off this field, never off error-message substrings.

| `failure_kind` | Meaning | Recovery |
| --- | --- | --- |
| `offline_go_module_cache` | Neither the Wharnex-owned private Go cache for this project nor the Wharnex runtime's own compatibility cache can satisfy the build list under `GOPROXY=off`. That private cache is keyed on the canonical project and MUST stay so even when the run executes an extracted immutable base (`adr/ADR-0045`); the compatibility fallback reads the Wharnex runtime's GOMODCACHE, which is the operator's machine only in development mode. | Human-approved, narrowly scoped network grant for the eligible Go commands (`RetryDependencyNetwork`; see `SANDBOX_MODEL.md`). |
| `host_dependency_state` | Host-only npm/node dependency defect discovered after Protected verification already passed (e.g. the npm optional-dependency bug, npm/cli#4828). | Fixed, human-approved reinstall recipe run directly on host (`RetryHostDependencyRepair`; see `SANDBOX_MODEL.md`). |
| `host_build_toolchain_mismatch` | Host's own toolchain (e.g. Node running a self-evolution build) can't satisfy a pinned dependency's engine requirement. | None — no source patch changes the host's installed runtime. Manual host upgrade only. |
| `self_evolution_transaction_busy` | Another self-evolution transaction currently owns the activation lock. | Retry Apply once the other transaction clears — the verified candidate is retained. |
| `stale_host_baseline` | A retained legacy candidate could not be safely replayed/reverified on the current host baseline. | Explicit human retry/review of the retained candidate. |
| `host_integration_race` | Repeated compare-and-swap races committing an already-verified candidate. | Retry Apply — this is host concurrency, not a model/source defect. |
| `execution_context_canceled` | A sandbox/host command was interrupted by request cancellation. | Not evidence the generated source is defective; safe to resume/retry. |
| `remote_input_transport` | The request ended because the Desktop/remote ChatGPT transport or returned bundle could not be completed or validated. | Retry the original task as a fresh request from current context; do not ask GPT to repair project source merely because transport failed. |
| `submodule_write` | Bundle ingestion proved that the patch writes inside a Git submodule with no usable checkout in this worktree, so there is no repository to commit the change into. This is repository topology, not transport or planner-source failure. Writing inside an *initialized* submodule is supported and never produces this condition (see `adr/ADR-0050`). | Terminal for this project/request. Do not create a fresh ChatGPT request or offer source repair/retry. Initialize or repair the named submodule's local checkout (`git submodule update --init -- <path>`) and repeat the request, or change files outside it. |
| `sandbox_resource_exhausted` | A Protected command failed because the machine ran out of disk, memory or file descriptors mid-run (for example a linker reporting `no space left on device` during a race-enabled build). Derived from real command output, never from planner text. | Free host resources or narrow the verification set, then retry the retained candidate. The generated source is not implicated and rewriting it cannot help. |
| `artifact_storage_full` | The local artifact object store refused a write for lack of space (`XMinioStorageFull` or equivalent). | Free object-store space or lower artifact retention. The affected request is **not** failed by this: archival is bookkeeping and the verified result still executes. |
| `host_working_state_blocked` | Wharnex refused to integrate because the host working tree is in a state where committing on top of it would damage the operator's own uncommitted work: an unfinished merge/rebase/cherry-pick/am, unresolved conflict paths, or a change that moves the recorded commit of a submodule holding uncommitted content that Wharnex is not itself integrating into (see `adr/ADR-0039`, narrowed by `adr/ADR-0050`). | The operator's own action, named in the failure text and its `host.apply_blocked` event: finish or abort the operation, resolve the paths, or commit/stash the work inside the submodule. The verified candidate is retained; Apply then succeeds unchanged. |

None of these classifications ever consume an automatic ChatGPT source-repair round: each represents an infrastructure, lifecycle, host, or transport condition for which a new source patch is not the defined recovery.

## Auxiliary-payload failures MUST NOT invalidate an executable payload

A response bundle carries a verified executable result plus auxiliary material: the archived copy of the bundle itself and the project-knowledge candidate with its cumulative summary. A defect in the auxiliary material MUST NOT reject the bundle.

- Artifact archival failure publishes `artifact.persist_degraded` and ingestion continues. Only the archived copy is missing.
- Knowledge staging failure publishes `knowledge.stage_skipped` with a `reason` and ingestion continues. `concurrent_catalog_revision` means a peer chat advanced the catalog while this request was in flight — routine, self-correcting on the next round, and never a planner defect. `invalid_knowledge_payload` means the returned catalog was structurally wrong.

This rule exists because both failures were observed discarding a complete, verified change over bookkeeping that is committed separately and later.

## Repairable failures MUST name their root cause

A missing executable (exit 127 for a binary absent from the runner image) is repairable — the planner can pick another tool — but only when the repair request says so. The repair prompt MUST identify the missing executable explicitly instead of handing over raw output, which invites re-reading project source that was never at fault. The environment manifest (`SoT/SANDBOX_MODEL.md`) publishes the installed inventory so this condition should not arise at all.

Failures without one of these infrastructure classifications are repairable planner failures. Wharness attempts their bounded GPT repair automatically and retains a manual GPT repair fallback with optional operator guidance after automatic preparation, transport, or attempt exhaustion fails.

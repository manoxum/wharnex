# Error Model SoT

Errors crossing the HTTP boundary use:

```json
{"error":{"code":"stable_code","message":"human readable message"}}
```

Do not return raw secrets, environment dumps, provider authorization headers, or full internal stack traces.

## Session failure classification (`FailureKind`)

A terminal session failure MAY carry `failure_kind`: Wharness's own closed-set classification (`domain.FailureKind*`), always derived by Wharness itself from a local/sandbox error or a planner turn's reason code — never copied verbatim from planner-supplied text. Frontend recovery affordances MUST key off this field, never off error-message substrings.

| `failure_kind` | Meaning | Recovery |
| --- | --- | --- |
| `offline_go_module_cache` | Neither the Wharness-owned private Go cache nor the host compatibility cache can satisfy the build list under `GOPROXY=off`. | Human-approved, narrowly scoped network grant for the eligible Go commands (`RetryDependencyNetwork`; see `SANDBOX_MODEL.md`). |
| `host_dependency_state` | Host-only npm/node dependency defect discovered after Protected verification already passed (e.g. the npm optional-dependency bug, npm/cli#4828). | Fixed, human-approved reinstall recipe run directly on host (`RetryHostDependencyRepair`; see `SANDBOX_MODEL.md`). |
| `host_build_toolchain_mismatch` | Host's own toolchain (e.g. Node running a self-evolution build) can't satisfy a pinned dependency's engine requirement. | None — no source patch changes the host's installed runtime. Manual host upgrade only. |
| `self_evolution_transaction_busy` | Another self-evolution transaction currently owns the activation lock. | Retry Apply once the other transaction clears — the verified candidate is retained. |
| `stale_host_baseline` | A retained legacy candidate could not be safely replayed/reverified on the current host baseline. | Explicit human retry/review of the retained candidate. |
| `host_integration_race` | Repeated compare-and-swap races committing an already-verified candidate. | Retry Apply — this is host concurrency, not a model/source defect. |
| `execution_context_canceled` | A sandbox/host command was interrupted by request cancellation. | Not evidence the generated source is defective; safe to resume/retry. |
| `remote_input_transport` | The request ended because the Desktop/remote ChatGPT transport or returned bundle could not be completed or validated. | Retry the original task as a fresh request from current context; do not ask GPT to repair project source merely because transport failed. |
| `submodule_write` | Bundle ingestion proved that the patch writes inside a registered Git submodule while the open project is the superproject. The patch belongs to another repository; this is repository topology, not transport or planner-source failure. | Terminal for this project/request. Do not create a fresh ChatGPT request or offer source repair/retry. Open the indicated submodule as its own Wharness project, make the change there, then update the superproject gitlink if required. |
| `sandbox_resource_exhausted` | A Protected command failed because the machine ran out of disk, memory or file descriptors mid-run (for example a linker reporting `no space left on device` during a race-enabled build). Derived from real command output, never from planner text. | Free host resources or narrow the verification set, then retry the retained candidate. The generated source is not implicated and rewriting it cannot help. |
| `artifact_storage_full` | The local artifact object store refused a write for lack of space (`XMinioStorageFull` or equivalent). | Free object-store space or lower artifact retention. The affected request is **not** failed by this: archival is bookkeeping and the verified result still executes. |
| `host_working_state_blocked` | Wharnex refused to integrate because the host working tree is in a state where committing on top of it would damage the operator's own uncommitted work: an unfinished merge/rebase/cherry-pick/am, unresolved conflict paths, or a change that moves the recorded commit of a submodule holding uncommitted content (see `adr/ADR-0039`). | The operator's own action, named in the failure text and its `host.apply_blocked` event: finish or abort the operation, resolve the paths, or commit/stash the work inside the submodule. The verified candidate is retained; Apply then succeeds unchanged. |

None of these classifications ever consume an automatic ChatGPT source-repair round: each represents an infrastructure, lifecycle, host, or transport condition for which a new source patch is not the defined recovery.

## Auxiliary-payload failures MUST NOT invalidate an executable payload

A response bundle carries a verified executable result plus auxiliary material: the archived copy of the bundle itself and the project-knowledge candidate with its cumulative summary. A defect in the auxiliary material MUST NOT reject the bundle.

- Artifact archival failure publishes `artifact.persist_degraded` and ingestion continues. Only the archived copy is missing.
- Knowledge staging failure publishes `knowledge.stage_skipped` with a `reason` and ingestion continues. `concurrent_catalog_revision` means a peer chat advanced the catalog while this request was in flight — routine, self-correcting on the next round, and never a planner defect. `invalid_knowledge_payload` means the returned catalog was structurally wrong.

This rule exists because both failures were observed discarding a complete, verified change over bookkeeping that is committed separately and later.

## Repairable failures MUST name their root cause

A missing executable (exit 127 for a binary absent from the runner image) is repairable — the planner can pick another tool — but only when the repair request says so. The repair prompt MUST identify the missing executable explicitly instead of handing over raw output, which invites re-reading project source that was never at fault. The environment manifest (`SoT/SANDBOX_MODEL.md`) publishes the installed inventory so this condition should not arise at all.

Failures without one of these infrastructure classifications are repairable planner failures. Wharness attempts their bounded GPT repair automatically and retains a manual GPT repair fallback with optional operator guidance after automatic preparation, transport, or attempt exhaustion fails.

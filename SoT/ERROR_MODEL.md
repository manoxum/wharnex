# Error Model SoT

Errors crossing the HTTP boundary use:

```json
{"error":{"code":"stable_code","message":"human readable message"}}
```

Do not return raw secrets, environment dumps, provider authorization headers, or full internal stack traces.

## Session failure classification (`FailureKind`)

A terminal session failure MAY carry `failure_kind`: Wharness's own closed-set classification (`domain.FailureKind*`), always derived by Wharness itself from a sandbox error or a planner turn's reason code — never copied verbatim from planner-supplied text. Frontend recovery affordances MUST key off this field, never off error-message substrings.

| `failure_kind` | Meaning | Recovery |
| --- | --- | --- |
| `offline_go_module_cache` | Host Go module cache can't satisfy the build list under `GOPROXY=off`. | Human-approved, narrowly scoped network grant for the eligible Go commands (`RetryDependencyNetwork`; see `SANDBOX_MODEL.md`). |
| `host_dependency_state` | Host-only npm/node dependency defect discovered after Protected verification already passed (e.g. the npm optional-dependency bug, npm/cli#4828). | Fixed, human-approved reinstall recipe run directly on host (`RetryHostDependencyRepair`; see `SANDBOX_MODEL.md`). |
| `host_build_toolchain_mismatch` | Host's own toolchain (e.g. Node running a self-evolution build) can't satisfy a pinned dependency's engine requirement. | None — no source patch changes the host's installed runtime. Manual host upgrade only. |
| `self_evolution_transaction_busy` | Another self-evolution transaction currently owns the activation lock. | Retry Apply once the other transaction clears — the verified candidate is retained. |
| `stale_host_baseline` | A retained legacy candidate could not be safely replayed/reverified on the current host baseline. | Explicit human retry/review of the retained candidate. |
| `host_integration_race` | Repeated compare-and-swap races committing an already-verified candidate. | Retry Apply — this is host concurrency, not a model/source defect. |
| `execution_context_canceled` | A sandbox/host command was interrupted by request cancellation. | Not evidence the generated source is defective; safe to resume/retry. |

None of these classifications ever consume an automatic ChatGPT repair round: each represents a local/host condition no source patch can fix, so routing it into the planner repair loop would only spend a bounded repair attempt the model cannot satisfy.

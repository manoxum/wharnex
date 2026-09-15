# ADR-0055 — Self-contained cumulative correction bundles

- Status: accepted
- Amends: `adr/ADR-0041`, `adr/ADR-0052`
- Evidence: chats `9b137172-d3d1-4f7f-90f2-b35b15dc7e54` and `1d98f504-f2d8-4afa-9eeb-aaf536706b52` (2026-09-15)

## Context

The incremental ledger and root-relative context delta reduced repeated repairs,
but Desktop correction archives still depended on the remote conversation to
retain the original full snapshot. They carried only the latest execution
rendering, while older command output and the response bundles that proposed
each approach remained in local artifact storage. In the observed incidents the
planner twice reported `input_bundle_unavailable`; in another chain it correctly
diagnosed a host-only verification defect but could not replace the stale gate
already retained by the engine.

The Flowcore failure also exposed an observability defect: a missing `rg`
executable in the control container was collapsed by `HostRunner` into exit
`-1` with empty stdout/stderr. The existing unsupported-host-gate classifier
therefore had no evidence with which to distinguish infrastructure from source.

## Decision

Every derived request archive is self-contained and cumulative for its Main
Request. It carries the refreshed complete project context, the root-relative
`harness.context-delta/v1` report, `attempts/events.json` using
`harness.execution-history/v1`, and every earlier response bundle under
`responses/` with a `harness.response-history/v1` index.

Historical response bundles are evidence, never executable input. Normal
validation still accepts only the new bundle correlated to the active request.
An expired/unreadable historical object is named in the index and does not block
the current request. Existing string, event-redaction and transport-size bounds
remain mandatory.

Process-start failures are normalized at the runner boundary. A missing
executable becomes exit 127 with the concrete `exec` diagnostic, allowing the
existing host-infrastructure classifier to record the gate as unsupported
instead of reverting a Protected-verified candidate and requesting source
repair.

## Consequences

Correction archives are larger, deliberately trading bandwidth for convergence
and deterministic recovery. The delta remains necessary: a full snapshot
answers “what exists now”, while the delta answers “what moved since the Main
Request”. A planner no longer depends on conversation memory for prior code,
diagnostics, or its own earlier response bundles.


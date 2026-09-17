# ADR-0059 — Approval-gated debug host actions

## Status

Superseded by ADR-0060. The modifying-host decision is retained as historical
context only; pending and new modifying debug workflows are rejected rather
than grandfathered.

## Context
`harness.debug/v1` originally exposed only sandbox probes plus a small read-only host allowlist. That protected the workstation, but it also meant an active Debug session could not satisfy a user request that explicitly required a local host change or a diagnostic helper that was not installed. The planner could describe the limitation, but it could not return an executable local instruction set whose result flowed back into the same debug conversation.

## Decision
Extend the existing debug protocol with `access=observe|modify`; omitted access means `observe` for compatibility. `observe` keeps the existing read-only host boundary and its Main-Request-scoped authorization semantics. `modify` is valid only for `target=host`, must declare `risk=high` and `requires_approval=true`, and is authorized only for the exact `plan_id`. Debug mode never auto-approves it and the approval is cleared after the workflow round.

A modifying debug workflow remains command-only and never becomes a patch or Apply candidate. The Policy Engine remains the final authority over every argv command. Network may be requested only by the approved modifying plan. A missing host tool can be declared through `system_tools`; install/update/configure entries must identify `lifetime=temporary|persistent` so the operator sees whether the workflow intends disposable or durable host state. Lifetime is disclosure and consent metadata, not a privilege grant.

The planner prompt must prefer a bounded local workflow when local evidence can materially settle a Debug request, so Debug produces executable local instructions rather than a terminal guess. Engine-owned queries remain appropriate for facts that exist only in Wharnex's durable audit ledger.

## Consequences
- Safe observe probes preserve their previous automatic behavior when Debug is enabled.
- Host mutations and tool installation cannot ride on the standing Debug toggle; each plan requires a new operator decision.
- Debug workflows can now perform explicit, Policy-allowed host remediation and feed the resulting evidence back to the model.
- Privilege escalation, shell execution, Docker/host-service control, destructive primitives and other Policy-denied operations remain blocked.
- UI and audit projections must preserve the debug access level and tool lifetime so operator consent is informed after refresh/restart.

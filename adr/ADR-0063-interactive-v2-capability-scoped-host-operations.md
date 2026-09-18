# ADR-0063: Capability-scoped Interactive v2 host operations

## Status

Accepted.

## Context

Interactive v1 deliberately reduced host diagnosis to a closed read-only argv vocabulary. That boundary prevents destructive recovery, but it also prevents live diagnosis of failures whose decisive evidence exists only in the running Wharnex instance: worker/task state in the internal PostgreSQL database, backend/Desktop/service/container logs, narrowly scoped filesystem/process state, or a multi-command shell probe. Re-introducing generic `debug access=modify` would repeat the defect that ADR-0060 retired: one opaque program could discover and mutate arbitrary host state under a broad approval.

## Decision

Add `harness.interactive/v2` as a separate workflow protocol. V1 remains observation-only. V2 declares a target, `observe|modify` access, a closed set of capabilities and capability-specific scope. The typed operations are `command`, `shell`, `sql`, `logs`, `filesystem`, `process`, `network`, `container` and `service`. Protocol validation rejects undeclared capabilities, scope escape and observe-mode writes before execution.

Authorization is persisted as an Interactive grant bound to the Main Request root, protocol, target, access, capability set, scope and operation digest. Modify grants are high-risk, one-shot and exact-plan/digest bound. Disabling Interativo clears the grant. Host/sensitive observation is Policy-visible and consent-gated; a grant never authorizes patches or Apply.

Shell execution writes the exact approved script to a temporary file and invokes `bash <file>` via argv; it never builds `bash -c` from model text. Shell child processes inherit only `PATH`, the non-interactive Git guard, and environment names explicitly listed in `env_allowlist`. SQL references an engine-owned connection handle, never a password/DSN, and read-only mode uses a read-only transaction with statement/lock timeouts and row limits. Log adapters expose bounded/redacted Wharnex audit/backend, scoped file/Desktop, journald/service and container evidence. In the initial v2 implementation, engine-resident `sql`, `logs`, `filesystem`, `process`, `network`, `container`, and `service` adapters require `target=host`; sandbox workflows may use the sandbox runner's `command` and `shell` capabilities instead of silently routing these adapters to host state. Filesystem paths are symlink-resolved before scope checks; process signals are allowlisted; network destinations, service names and container names are explicit scope values. Every operation produces a structured bounded result and obeys context cancellation/timeout.

The existing workflow consent surface shows protocol, target, access, capabilities, scope and the typed operations. Wharnex's request/execution cancellation remains the stop boundary; a cancelled context terminates the active runner/database/network operation and records the existing execution-cancelled classification.

## Consequences

Live diagnosis can now gather the TODO worker's decisive host evidence without expanding a planner into unrestricted host authority. A diagnosis can combine the internal database handle, audit/backend logs and an exact shell probe in one explicitly scoped workflow. Sensitive evidence remains bounded and untrusted. New adapters/capabilities require explicit schema, validation, Policy, execution and UI work rather than becoming accidental powers of `command` or `shell`.

## Compatibility

Persisted `harness.debug/v1` and `harness.interactive/v1` sessions keep their original validation and grant semantics. Interactive v2 is additive and requires an explicit v2 plan; no existing v1 plan is upgraded implicitly.

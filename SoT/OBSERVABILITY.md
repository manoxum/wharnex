# Observability SoT

Every session emits ordered events with timestamp, type, session ID, and concise data. Events include context, planning, policy, execution, command, patch, verification, apply, and failure transitions.

Request and execution lifecycle events carry request lineage whenever applicable: `request_id`, `root_request_id`, optional `parent_request_id`, and `iteration_kind`. This correlation is durable and must not be inferred from localized error prose.

Secret values must be redacted before event publication.

## Durable operational evidence (v1.2.43)

Backend lifecycle events MUST be persisted before they are exposed as history, so a backend/Desktop restart does not erase request, transport, validation, Policy, queue, execution, correction, success or failure evidence. Persisted fields are bounded and redacted; raw credentials, complete environment values and unbounded command output are never operational evidence.

When, and only when, a session is canonically marked `self_evolution=true`, the Agent surface exposes the structured project evidence recorded since the latest successfully reconciled WHX self-evolution. It MAY prepare a `plan_first` AI review from that evidence. The review is a new correlated request with a fresh immutable context base and remains subject to the normal protocol, Policy, Protected sandbox, explicit plan approval and transactional self-evolution gates. Merely opening or naming another project “WHX” MUST NOT expose this capability.

## Self-evolution observability (v1.2.22)

Self-evolution publishes dedicated `self_evolution.*` events for transaction start, host build, rollback and restart scheduling. The detached supervisor persists its last lifecycle phase in `.harness/self-evolution/status` and appends restart/recovery output to `.harness/logs/self-evolution.log`. `make status` surfaces the latest self-evolution phase and plan id even across a process restart.

## ChatGPT liveness observability (v1.2.42.2)

Desktop liveness diagnostics distinguish renderer/network recovery from human-required intervention without logging remote response prose or credentials. Logs identify the owning chat key/request, sanitized URL/status, bounded recovery reason/attempt, DOM-health probe failures, page-load stalls, rate-limit backoff, and categorical human-action kind (`verification`, `authentication`, `access`, `surface`, `transport`, or `stalled`). Human-action IPC carries only the owning chat key, request id when present, categorical kind/source, a local explanatory message, and timestamp. CAPTCHA tokens, cookies, local/session storage and arbitrary ChatGPT page text MUST NOT enter logs, events or renderer IPC.

## Unresolved evidence ledger (v1.3.1)

Canonical WHX self-evolution exposes unresolved, redacted evidence across every opened project. Filters cover date/time, project, exact/partial event type and stable category, and only the explicit selection enters an AI analysis request. Resolution is stored by immutable event ID and occurs only after a verified/applied implementation reports IDs belonging to that review selection; restart time is not a resolution boundary.

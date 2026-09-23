# Observability SoT

Every session emits ordered events with timestamp, type, session ID, and concise data. Events include context, planning, policy, execution, command, patch, verification, apply, and failure transitions.

Request and execution lifecycle events carry request lineage whenever applicable: `request_id`, `root_request_id`, optional `parent_request_id`, and `iteration_kind`. This correlation is durable and must not be inferred from localized error prose.

Secret values must be redacted before event publication.

A runner pre-flight failure MUST NOT be represented as a successful process exit. If dependency preparation or another prerequisite fails before process creation, the recorded command retains its requested argv/cwd, uses synthetic exit code `-1`, reports `success=false`, and carries the bounded actionable cause in stderr.

## Durable operational evidence (v1.2.43)

Backend lifecycle events MUST be persisted before they are exposed as history, so a backend/Desktop restart does not erase request, transport, validation, Policy, queue, execution, correction, success or failure evidence. Persisted fields are bounded and redacted; raw credentials, complete environment values and unbounded command output are never operational evidence.

When, and only when, a session is canonically marked `self_evolution=true`, the Agent surface exposes the structured project evidence recorded since the latest successfully reconciled WHX self-evolution. It MAY prepare a `plan_first` AI review from that evidence. The review is a new correlated request with a fresh immutable context base and remains subject to the normal protocol, Policy, Protected sandbox, explicit plan approval and transactional self-evolution gates. Merely opening or naming another project “WHX” MUST NOT expose this capability.

## Integration reconciliation and escalation evidence (v1.3.6)

An Apply that reconciled a moved host path MUST publish `integration.reconciled_locally`, separating the paths the line-granular merge handled from those that needed the token tier and counting the hunks that tier resolved. Without this, a candidate that integrated only because sub-line granularity caught a false collision is indistinguishable afterwards from one that never collided at all, and the ladder's real effect cannot be measured.

Staging a merged candidate is the last step before the first host write. A failure there MUST publish `integration.staging_failed` with the underlying cause, because it retains a verified candidate that no host mutation has touched.

Every escalation decision MUST publish `integration.escalation_decided` with `automatic`, `complexity`, the affected paths, and the reason — in both directions. A decision *not* to spend a planner round is as much an operational fact as a decision to spend one: the failure this replaced was a request that silently waited, and silence is what made it invisible.

Field names carrying merge evidence avoid the substring `token`, which the audit redactor treats as a credential name. The key that says `subline_resolved_hunks` would otherwise publish `[REDACTED]` in place of the evidence it exists to carry.

## Self-evolution observability (v1.2.22)

Self-evolution publishes dedicated `self_evolution.*` events for transaction start, host build, rollback and restart scheduling. The detached supervisor persists its last lifecycle phase in `.harness/self-evolution/status` and appends restart/recovery output to `.harness/logs/self-evolution.log`. `make status` surfaces the latest self-evolution phase and plan id even across a process restart.

An engine-owned diagnostic query publishes `debug.query_completed` with its stable query name, success, duration and aggregate execution count; raw event bodies are not copied into that event. A duplicate Host Apply stopped after the locked durable reload publishes `host.apply_duplicate_blocked`. A failed pre-mutation self-evolution extension that retains the prior batch publishes `self_evolution.extension_aborted_retained`, and a later healthy restart that clears an older pending activation publishes `self_evolution.activation_reconciled` with both timestamps as evidence.

## ChatGPT liveness observability (v1.2.42.2)

Desktop liveness diagnostics distinguish renderer/network recovery from human-required intervention without logging remote response prose or credentials. Logs identify the owning chat key/request, sanitized URL/status, bounded recovery reason/attempt, DOM-health probe failures, page-load stalls, rate-limit backoff including the evidence kind (`transport` or `gate`), its source and the resulting suspension deadline, and categorical human-action kind (`verification`, `authentication`, `access`, `surface`, `transport`, or `stalled`). Human-action IPC carries only the owning chat key, request id when present, categorical kind/source, a local explanatory message, and timestamp. CAPTCHA tokens, cookies, local/session storage and arbitrary ChatGPT page text MUST NOT enter logs, events or renderer IPC.

## Browser-agent queue observability (v1.3.5.1)

The durable browser-agent queue MUST be reported as an aggregate computed by the session store, never by counting a listed page of tasks. The task list is ordered oldest-first and capped, so a client-side count silently stops describing the live queue as soon as settled history fills that window.

Queue depth is the queue, not its history. A settled task (`DONE`, `FAILED`, `CANCELLED`, `ATTENTION`) has left the queue and MUST NOT be counted in it, nor contribute to a lifetime total: such a tally reports past throughput while saying nothing about what is waiting to run.

Queue depth MUST distinguish work a worker could claim now from work that is merely deferred. A task held behind its own `not_before` is waiting on a clock, not on a worker: bundle-retention cleanup is enqueued days ahead by design, and reporting it as pending backlog makes a completely idle scheduler read as a stuck one. A task whose clock has elapsed can still be ineligible because the provider is paused or because durable account/conversation exclusivity protects another operation — notably, title/account work stays quiet while `AWAIT_RESPONSE` supervises a generating conversation. Adding idle Workers cannot clear those guards. The published summary therefore separates `due`, `scheduled`, `guarded` and `blocked`: `due` is claimable now; `scheduled` waits on its own clock; `guarded` has time and attempt budget but waits on a provider/account/conversation guard; and `blocked` is past its attempt budget and will never drain. These categories MUST use the same durable predicate the claim query itself applies. Backlog age (`oldest_due_created_at`) MUST be derived only from `due` tasks; a deferred or guarded task is not late for lack of Worker capacity and MUST NOT age the Worker backlog.

A project-scoped queue view MUST compute its counters from the same project filter as its cards, because a panel whose totals describe a wider queue than its list is read as a stuck project that is in fact idle. It MUST NOT show another project's tasks; other-project work MAY be reported only as an aggregate count, which is what tells the operator the shared pool is busy elsewhere without disclosing whose work that is. An agent occupancy view is global, because the pool is: it MUST mark an agent whose current task belongs to a different project than the surface displaying it, name that project, and expose nothing else about that task.

Settled task rows (`DONE`, `FAILED`, `CANCELLED`) are operational bookkeeping, not evidence: durable request history lives in the persisted event history above. They MUST be swept on a retention window rather than retained indefinitely. The window MUST stay comfortably longer than any single request lifecycle, because a completed child task is what stops its parent from enqueuing the same follow-up twice.

## Durable plan and execution ledger (v1.3.6)

The session snapshot holds one current plan and one last execution, and several lifecycle transitions clear both. It is therefore working state, never the record: every intermediate plan and every intermediate execution — repair rounds, workflow rounds, failed verifications — is overwritten as soon as the next one starts, which is why the Plans and Executions views appeared to reset after a restart.

Every plan the AI authors and every execution result MUST additionally be appended to the persisted event history as `plan.recorded` and `execution.recorded`, carrying the complete plan and execution bodies rather than the metadata the surrounding lifecycle events already carry. Failed and policy-blocked runs are recorded on the same terms: a failed verification is the evidence that explains why the next round exists, and it is the first thing the snapshot discards. Workflow observation rounds are executions for this purpose.

Those records are the durable ledger. The project Plans and Executions views MUST be built from it, with the live session snapshot layered on top so an entry that is still current keeps its richer lifecycle label. Because the ledger lives in the persisted event history, it survives restart and is included in a chat archive package without a second store.

Ledger bodies are published through the ordinary audit path precisely so redaction and the bounded-string rule apply to them; they are not exempt from "Secret values must be redacted before event publication". Sanitization MUST traverse nested arrays, because a decoded plan's operations and an execution's per-command output arrive inside them and would otherwise bypass both redaction and the length bound.

## Unresolved evidence ledger (v1.3.1)

Canonical WHX self-evolution exposes unresolved, redacted evidence across every opened project. Filters cover date/time, project, exact/partial event type and stable category, and only the explicit event selection and/or explicitly imported dossier enters an AI analysis request. **Analyze with AI** always creates or reuses a dedicated self-evolution Harness chat and never takes over the user's currently active conversation. Resolution is stored by immutable event ID across all canonical self-evolution sessions and occurs only after a verified/applied implementation reports IDs belonging to that review selection; restart time and the currently selected analysis chat are not resolution boundaries.

The same panel MAY accept an explicit user-selected operational dossier (`.md`, `.json`, `.log`, `.txt`, or ZIP). It is stored as a typed input artifact and accepted for analysis only under that type; its contents are untrusted evidence, never instructions or execution authority. ZIP inspection is bounded by count, entry size and UTF-8 text, and all text is sanitized before it enters the plan-first prompt. Import metadata, not the imported body, is published in the lifecycle event. This path remains canonical-WHX-only and has the same Protected/Policy/approval gates as ledger-only analysis.

## Durable Main Request decision ledger (v1.3.10, see `adr/ADR-0064`)

Every decision the ChatGPT transport/recovery layer makes around a Main
Request — a recovery reload, an automatic or manual continuation
("keep continue" / "Retomar pedido"), a bundle validated or rejected, a
human escalation — MUST be durably recorded, not only logged. This is
narrower than, and complements, the durable plan/execution ledger above: it
covers the transport/automation layer that submits and supervises a request,
not the planner's own plan/execution bodies.

Records are anchored to the chat-agent task the Main Request already creates
(`AWAIT_RESPONSE` — every Main Request creates one, whether claimed by the
Supervisor or Worker pool; see "Browser-agent queue observability" above) and
carry `request_id`/`root_request_id` so every task touched by one Main
Request (an initial `AWAIT_RESPONSE` plus a later `RECOVERY_WRITE`) can be
correlated. Event bodies MUST be redacted through the same rules as every
other durable event (`audit.SanitizeEventData`); this is not a second,
looser redaction path.

Recording an event MUST be best-effort from the caller's perspective: a
failure to record observability MUST NOT fail the automation it describes.
Creating the anchoring `AWAIT_RESPONSE` task itself is the one exception —
it is the Main Request's only durable record, so its enqueue MUST retry a
bounded number of times and, if every attempt fails, MUST fail the
submission rather than let a Main Request proceed with zero durable trace.

Event rows are operational bookkeeping, not evidence to retain indefinitely:
they MUST be swept on the same retention window as their owning task row
(see "Browser-agent queue observability" above), not kept forever.

## Interactive v2 evidence

Interactive v2 publishes `interactive.operation_started` and `interactive.operation_completed` around every typed operation. Completion evidence includes only bounded/redacted metadata and result content; secrets and unbounded stdout/stderr are not audit state. Workflow observations sent back to the planner include the structured interactive result list so a diagnosis can correlate a SQL/log/shell probe with its capability and target without scraping localized prose. The persisted grant identifies the approved protocol, root request, target, access, capabilities, scope and digest so a later audit can explain why an operation was allowed.

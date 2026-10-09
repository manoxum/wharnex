# Observability SoT

## Bundle transport statistics

The workspace three-hour bundle counter projects persisted operational evidence,
across every pool and task type. `chatgpt-upload confirmed` records one observed
successful file upload; preparation, retries without confirmation and downloads
never consume the upload limit. Its bounded metadata includes the owned filename
and task when known. `chatgpt-bundle-received` records completed, bounded bundle
downloads before semantic validation, including responses subsequently rejected.
Only metadata is recorded, never bundle bytes, screenshots or remote prose.
Historical chat acknowledgements and utility bundle-delivery HTTP calls may fill
older receive counts, with inferred deliveries explicitly labelled as estimates.
One download and its later delivery/acknowledgement must never be counted twice.
The projection uses the complete filtered window, not a paginated log sample,
and survives runtime restart within the operational log retention period. Query
failure is reported as unavailable instead of a successful zero-consumption
snapshot. Existing artifact counts remain a development-store fallback only.

Git index-lock maintenance emits `git.index_lock_recovery_completed` or
`git.index_lock_recovery_blocked` operational records with repository, bounded
lock path, age and a categorical reason (`adr/ADR-0092`). The calling context's
session/request/chat/task identities are retained when available. Recording
uses the asynchronous redacted operational writer and cannot fail the Git work.
Process arguments, environments, descriptors and file contents are never logged.

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

## Canonical execution-failure evidence (v1.3.6+)

Startup integration cleanup MUST publish `integration.branch_cleanup_deferred` only when a persisted project root is objectively absent and a live Host Apply candidate still depends on it. This warning means no Git cleanup was attempted: the candidate stays durable until the operator restores the project root or explicitly discards it. It is not a patch/model defect, not evidence of a global Git failure, and MUST NOT authorize automatic candidate disposal. Missing roots without live candidates are skipped silently and rechecked on later startups so a restored project returns to normal reconciliation.

A failed execution has one engine-owned `failure_kind` for the round. The attribution is result-aware: structured failed-command evidence outranks generic outer cancellation, specific runner/self-evolution sentinels outrank `context.Canceled`, and cancellation is used only as a fallback. Every durable or live surface for that same round — `execution.error_recorded`, `execution.failed`, `automation.infrastructure_blocked`, and the attempt ledger — MUST expose the same classification rather than re-deriving it from event-local prose.

`execution.errors_resolved` is host-integration evidence, not sandbox-verification evidence. For Protected corrections it MUST be emitted only after `host.applied`; self-evolution emits it only after the host build has succeeded and the durable state is `restart_pending`. A restart may replay the durable `LastAppliedChanges` proof to finish this bookkeeping, but already-solved rows MUST NOT produce duplicate resolution events.

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

An execution record's `request_id` MUST identify the request that authored the
executed plan, independently of `plan_id` and any later continuation request.
Workflow observation writers MUST retain that identity when the snapshot advances.

Those records are the durable ledger. The project Plans and Executions views MUST be built from it, with the live session snapshot layered on top so an entry that is still current keeps its richer lifecycle label. Because the ledger lives in the persisted event history, it survives restart and is included in a chat archive package without a second store.

Ledger bodies are published through the ordinary audit path precisely so redaction and the bounded-string rule apply to them; they are not exempt from "Secret values must be redacted before event publication". Sanitization MUST traverse nested arrays, because a decoded plan's operations and an execution's per-command output arrive inside them and would otherwise bypass both redaction and the length bound.

## Unresolved evidence ledger (v1.3.1)

Canonical WHX self-evolution exposes unresolved, redacted evidence across every opened project plus reusable durable knowledge from categories `conflict_resolution`, `patch_strategy`, `execution_repair`, `verification`, `runtime_environment`, and `protocol_transport`. `product_domain` and `general` knowledge is excluded before the provider boundary so project-specific business rules cannot become WHX evolution evidence. Filters cover project/category/type/search, and only the explicit event selection, explicit eligible-knowledge selection and/or explicitly imported dossier enters an AI analysis request. **Analyze with AI** always creates or reuses a dedicated self-evolution Harness chat and never takes over the user's currently active conversation. Resolution is stored only for immutable event IDs across all canonical self-evolution sessions and occurs only after a verified/applied implementation reports IDs belonging to that review selection; knowledge records remain durable source evidence and are never marked resolved by an evolution review.

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

## Classified operational log (v1.3.20, see `adr/ADR-0075`)

Everything the engine does MUST reach one classified, correlated store, `harness_operational_log`: every audit-bus event (mirrored with `event_ref` to its `harness_events` row), every backend `log` line (`component=backend-log`), and every Desktop `console` line (`source=desktop`, channel as component). Each record carries `occurred_at`, `source`, `component`, `level` (closed set `trace`/`debug`/`info`/`success`/`warning`/`error`), `category`, `event`, a bounded redacted `message`, correlation (`session_id`, `request_id`, `root_request_id`, `chat_id`, `task_id`, `plan_id`, `project_id`) and bounded scalar `data`. Classification MUST be derived by the engine's fixed table from the event or channel name, never from localized prose.

The log references complete bodies instead of copying them: plans, executions and execution errors stay in their own ledgers, which remain the chat history. Records pass the same redaction and bounding as every durable event, and a client may write only `desktop`/`frontend` records — never backend records, ids or ledger references.

Recording MUST NOT slow or fail the work it records. The backend writer is asynchronous and bounded and drops-and-counts when full; the Desktop shipper is bounded, times out, keeps records while the backend restarts and never logs through the console it captures. Write failures go to stderr, never through the captured logger.

The ingest (`POST /api/operational-log`) and query (`GET /api/operational-log`) endpoints are local-only and MUST refuse the paired remote ingress.

Retention is automatic and nothing is kept longer than 15 days: `trace`/`debug` records expire after 3 days and every other record after 15 days, swept hourly. The same sweep removes the fixed set of high-volume progress event types (`command.output`, host build output, git fetches, status reconciliation, context refresh) from `harness_events` after 15 days; lifecycle, plan, execution and error ledger events are chat history and are not swept by age.

Every backend HTTP call MUST be observed. Errors, calls of 2 s or more, mutations, request-input transport calls and event-stream closes are recorded individually as `http.request` with route, status, duration, bytes and route-derived correlation; healthy polling and fast reads are aggregated per route per minute as `http.calls_aggregated`, because recording ~12 task claims per second individually would drown the evidence it exists to keep. One operation is correlated across processes by `X-Wharnex-Trace`: the backend echoes a well-formed trace or generates one, and the Desktop scopes each scheduler attempt and each transport preparation to its own trace, sends it only to the local backend and stamps it on every console line.

Self-evolution status reconciliation runs on every session read and MUST persist and publish only when the projection actually changes; re-announcing an unchanged state is noise that drowns evidence.

## Runtime memory governance (v1.3.38)

Backend memory MUST be bounded by live work, never by uptime or by accumulated history. Durable history is read back from its store: the event bus MUST NOT keep persisted events in memory, and only events the store refused are kept, in a bounded per-session window. Subscriber bookkeeping for a session MUST be released with its last subscription. Session residency follows `SoT/ARCHITECTURE.md` (Session residency).

Polled read-only JSON snapshots (session, project file tree, Git overview/head, Orchestrator overview, browser-agent tasks/summary/provider, workspace attention) MUST carry an `ETag` and answer a matching `If-None-Match` with `304` and no body. The Desktop client MUST resolve a `304` to the object the previous poll produced, so an unchanged poll neither re-parses the document nor re-renders the view that holds it.

The Desktop Git surface MUST NOT poll `/git/head`. Its live session stream carries a `git.changed` invalidation after the backend observes a changed repository signature. One backend observer per project samples only while at least one session stream is subscribed, and the renderer reloads its authoritative Git overview on invalidation and stream reconnection. The invalidation contains no repository contents and is appended to the durable event ledger; old invalidations are omitted from stream catch-up to avoid a request burst after reconnect. Other session mutations continue to use the existing classified event stream. Snapshot ETags remain available for explicit reads and older clients.

A browser-agent task transition (`start`, `heartbeat`, `wait`, `checkpoint`, `complete`, `fail`, `attention`, `assign`) requested with `Prefer: return=minimal` (RFC 7240) MUST be answered with the lease-state acknowledgement only — id, status, attempts, `not_before`, lease expiry, update time — and `Preference-Applied`; callers that omit the preference keep receiving the whole task. The Desktop scheduler never reads a transitioned task back and MUST ask for the minimal form. Scheduler loops whose claims find nothing MUST back off exponentially from their idle cadence to a ceiling of a few seconds, resetting on a claimed task or an explicit wake; lane residency and pin release are measured in elapsed time, so the ceiling delays them by at most one step.

The backend applies its own Go soft memory limit from `WHARNEX_BACKEND_MEMORY_LIMIT_MB` through the runtime API, never through `GOMEMLIMIT`, because the toolchains it spawns would inherit a limit sized for the engine. `WHARNEX_RUNTIME_STATS_INTERVAL` logs heap, released memory, goroutine and GC counts on a fixed cadence so growth can be followed live. `WHARNEX_PPROF_ADDR` serves `net/http/pprof` on its own listener and MUST be refused unless it binds a loopback address; in the stack it is therefore reachable only through `docker exec`, never through the gateway or a tunnel.

## Extraction execution visibility (2026-10-09)

The Execução surface MUST project workflow/debug extraction rounds from
`command.started/output/completed`, `interactive.operation_started/completed`
and the durable `execution.recorded` bodies. Every recorded command retains
exact argv/cwd, exit/success, duration and both bounded/redacted output streams;
typed non-command operations retain capability, target, result/error and
truncation/redaction markers. Expired live output events and a cleared session
snapshot MUST NOT erase these ledger results. The UI reconciles streamed runs
with their recorded result by execution/plan, time interval and ordered argv/cwd
occurrence, preserving repeated identical commands as distinct runs and avoiding
a duplicate card for the same run. Newly arriving output opens automatically;
explicit operator collapse remains respected. The interactive human PTY remains
outside this Agent execution projection and its output stays ephemeral.

Git topology inspection MUST stream NUL-delimited index records and retain only
gitlinks; ordinary tracked files MUST NOT be materialized or split in memory to
discover submodules. The index remains authoritative on each inspection, including
unregistered gitlinks and conflicted stages; no stale topology cache is allowed.

The frontend durable-history refresh key MUST include request/continuation ids,
not only their root Main Request ids. Each completed workflow round may leave
the bounded live event window after the snapshot advances; a same-root
continuation therefore refreshes the persisted ledger just like a new Main
Request. A chat switch MUST hide outgoing history until the new session's
history is available.

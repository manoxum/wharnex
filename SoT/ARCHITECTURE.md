# Architecture SoT

## Macro architecture

Wharness uses ports-and-adapters / Clean Architecture boundaries:

`transport -> application -> domain <- ports <- adapters`

Planner adapters and sandbox adapters are replaceable. AI providers cannot depend on Docker execution details. Executor logic cannot depend on OpenAI response formats beyond the normalized domain plan.

Remote context delivery adds a storage port at the application seam. The
application builds one provider-neutral input artifact and asks that port to
publish/delete it; HTTP/WebDAV and rclone are adapters behind the seam. Domain,
planner, policy, and sandbox packages do not import provider concerns.

The port accepts one input artifact plus provider-neutral shape metadata. Its
pool implementation owns priority, account-scoped quotas, durable usage,
retention, and failover behind that single interface; application callers do
not select adapters or accounts.

Application orchestration owns one deep remote-context cache module keyed by
canonical project and semantic context hash. Its small interface hides eager
publication, same-hash reuse, expiry, and same-key in-flight collapse. The
storage pool remains unaware of chats and request prompts. Request-specific
enrichment is a separate path through the same publication port.

Provider enrollment uses a separate, small application seam: catalogue,
connect, check and disconnect. The rclone enrollment adapter maps curated
provider ids (Drive, Dropbox, OneDrive, S3, WebDAV, Nextcloud and others) to
provider-specific configuration and browser OAuth while the publication port
remains provider-neutral. Transport code never constructs commands or handles
provider semantics directly.

## Core workflow

`Session -> Context -> Agent Turn -> [Answer | Clarification | Investigation | Workflow Step | Change Plan]`

The change branch continues through:

`Change Plan -> Policy -> Informed Execution Decision -> Sandbox Execute -> Verify -> Authorized Host Integration`

The iterative evidence branch is bounded and non-mutating on the host:

`Workflow Plan -> Policy -> Disposable Protected Sandbox -> Structured Observations -> Refreshed Context -> Same Planner Conversation -> next Agent Turn`

There is no direct `AI -> shell` path. MCP, when introduced, is an adapter behind application ports rather than a route around Policy/sandbox boundaries.

## Services

- `services/frontend`: React local user experience, served only on the private Compose network.
- `services/frontend` remote build (`webapp` service): the same React application compiled for paired remote management, limited to Agent and Orchestrator top-level modes and served only on the private Compose network.
- `services/gateway`: Nginx ingress for Wharnex application traffic. It is the only application service that publishes a host port in the canonical stack (`127.0.0.1:6969` by default).
- `services/backend`: Go API/orchestrator, executed in Compose and connected to the host Docker daemon only as the trusted owner of Protected runner creation. It is not host-published in stack mode.
- `services/backend/cmd/tunnel` + `services/tunnel`: dedicated Go tunnel daemon/runtime. It owns all tunnel-provider processes and persisted public-channel resources independently from backend lifetime.
- `database`: PostgreSQL 17 Compose service with a named persistent volume.
- `services/desktop`: Electron/Desktop host process; it is intentionally not containerized.
- `docker/runner`: ephemeral Protected execution environment, never a persistent Compose service and never given the Docker socket.

## Session persistence

The Session Store seam is implemented in production by PostgreSQL. Each
Harness Session is an independent record with indexed identity/lifecycle
columns and one JSONB aggregate payload. Updating one session MUST NOT rewrite
unrelated sessions. The backend MUST fail closed if its configured database is
unavailable; a file fallback is forbidden in production.

The canonical local lifecycle owns PostgreSQL as a persistent Compose service backed by a project-specific named volume; the database is not published publicly. On the first stack migration, compatible PostgreSQL 17 data from the former `.harness/postgres/data` PGDATA is copied offline into that named volume when it is pristine. Because an older migration marker may outlive an incomplete/empty Compose initialization, startup also performs a separate one-time logical reconciliation fence: it reads the legacy PostgreSQL 17 source, merges its rows into the Compose database without overwriting existing primary keys, verifies that the target contains at least the legacy session count, and only then records reconciliation success. The previous `sessions.json` remains a Legacy Session Snapshot: it is imported transactionally and idempotently, retained for recovery, and never written after PostgreSQL becomes authoritative.

### Tunnel daemon boundary

The backend MUST NOT own tunnel process lifetime in stack mode. It communicates with the dedicated tunnel daemon over an internal Docker-network HTTP API authenticated with a generated local bearer token. The daemon owns provider processes, provider credentials, request-channel storage, retention and public URL lifetime. Backend shutdown/replacement therefore cannot call provider session stop. Normal lifecycle reconciliation MUST preserve the tunnel container. Explicit `stack-stop`/`stack-down` may terminate it and consequently invalidate ephemeral URLs.

Backend-created context/sandbox temporary files used by the host Docker daemon or tunnel daemon live under a host-visible `.harness/bridge` mounted at the same absolute pathname. The tunnel daemon accepts publication source paths only from this bridge and copies them into its own persistent volume before exposing them.

### Gateway and paired remote-management boundary

The canonical stack has one host-facing application ingress: `services/gateway`. Its local listener routes same-origin `/api/` requests to the backend and all other routes to the local frontend. Backend, local frontend and remote webapp have no host-published application ports. Desktop therefore targets only the gateway origin in stack mode. Internal database, object-store and tunnel-daemon control endpoints remain on their existing private boundaries and are not made browser-facing by the gateway.

The tunnel daemon may expose a second, private gateway listener through an already-configured public tunnel. That listener serves the remote frontend and same-origin backend API, but it is not itself host-published. Browser/Supervisor `WebContentsView` instances remain owned and executed only by Desktop; the remote webapp is a control surface over the existing backend/Desktop orchestration and MUST NOT create a second browser runtime. The public tunnel continues to own exact request-channel and stored-object routes before proxying ordinary application paths, so remote management cannot shadow or enumerate those capability URLs.

Remote-management authorization is an explicit pairing seam described in `SoT/SECURITY_MODEL.md` and `adr/ADR-0071`. A gateway-added remote marker distinguishes the public ingress from local same-origin traffic; the local listener clears that marker rather than trusting browser-supplied values. The backend alone creates and validates pairing/session credentials.
## Desktop multi-window and multi-project composition

The Electron main process owns a registry of desktop windows and canonical project-path leases. A canonical project path may be bound to at most one desktop window at a time; attempts from another window fail closed and may focus the owning window. This lease is a UI/runtime ownership boundary and does not weaken backend project containment or execution policy.

Each desktop window hosts a trusted local **workspace shell**. The shell may bind multiple projects and keeps one same-origin project renderer frame mounted per binding. Project selection changes visibility rather than remounting the project application, preserving React state, active requests, editor surfaces and page state during ordinary project switching. Each project renderer still creates/uses backend sessions scoped to its own `project_path`.

Remote ChatGPT rendering is process-global per authenticated profile: exactly six Supervisor `WebContentsView` slots exist, with only one visible at a time in the active Wharnex window, and a bounded pool of one to three persistent worker views (three by default), hidden by default, executes the small durable browser-agent jobs. The Worker pool can be resized at runtime; scale-down is non-preemptive and retires an excess renderer only after its current task settles and any explicit local interaction has ended. Chats persist a canonical provider `conversation_id`; renderer slots remain affinity caches and are not chat ownership.

A Supervisor slot is bound to one Harness chat for the life of its request (see `adr/ADR-0049`). It opens the conversation, submits the request bundle, follows the remote instance in real time and collects the response bundle, and it releases that chat only once it holds nothing unfinished *and* another chat is waiting for a slot. Selecting a resident chat is therefore a visibility change, not a navigation — which matters because every cross-chat load is a real authenticated provider request, and a two-slot pool serving many chats re-navigated on each switch with no work attached to it. The durable queue is partitioned by pool role at the claim: Supervisors take `AWAIT_RESPONSE`, `BOT_WRITE`, `RECOVERY_WRITE` and `ORCHESTRATOR_PLAN`; persistent Workers take account, title and classification work; the ephemeral Translator takes only `TRANSLATE_MARKDOWN`. The Translator uses the hardened Worker transport boundary for compatibility, but creates its hidden WebContents only after a translation claim and destroys it when that single task settles. Small jobs can never be dispatched to the Supervisor pool, and the Supervisor remains the normal human chat surface. The Agent runtime drawer MAY temporarily surface exactly one Worker view for explicit local interaction or route that same live view into the main Engine area through **Seguir (flow)** without changing scheduler ownership or navigation authority; the view is hidden again on exit, renderer failure, or window close. PostgreSQL persists typed task state and leases, and the runtime drawer reconciles Worker occupancy from current `LEASED`/`RUNNING` lease owners so Desktop/UI refreshes do not lose busy state.
That one queue serves every project, so a task's owning project is a first-class durable field: the canonical absolute host project path, resolved by the store at enqueue from a supplied absolute path, else from the task's own workspace chat, else from its session (see `adr/ADR-0044`). A ChatGPT project display name is never that identity. The renderer pool stays process-global and shared across projects; what is scoped per project is the claim. The Desktop passes the set of projects currently open in some window, and the durable claim admits a task only when the caller did not scope by project, or the task has no project attribution, or its project is open, or it is account-lifecycle work — `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_BUNDLE`, `DELETE_TEMP_CHAT` — which acts on the ChatGPT account rather than the project and MUST converge whatever is open. Scoping is a claim predicate, never a claim followed by a release: a claim charges an attempt. Closing a project admits nothing new and interrupts nothing already leased.

Worker routing uses transient slot residency on top of that durable queue. After a Worker reaches a conversation it keeps that lane for a 60-second default dwell (configurable down to 30 seconds), claims same-lane jobs first, and yields only through a fair rotation when no free Worker can serve an unresident lane. Every autonomous Worker action that can reach ChatGPT — navigation, reload, upload attempt, submit, and account-lifecycle action — shares one profile-global 30-second cadence; this is independent of slot residency and excludes Supervisor actions. The bounded artifact-only `TRANSLATE_MARKDOWN` utility is the sole Worker exception and has a separate five-second minimum cadence. Assignment epochs reject stale post-navigation callbacks, while physical-slot transport serialization prevents work from the prior resident lane overlapping a rebind. Request-bound follow-up jobs have a durable adaptive eligibility time with a one-minute floor; the estimate uses at most the latest 50 structurally observed ChatGPT processing-duration disclosures from already validated canonical bundles. Provider rate-limit state is durable and carries a kind. Any trusted HTTP 429 or account-wide gate — ChatGPT's own limit control, or repeated refusals from any trusted backend endpoint inside a short window — suspends the whole provider for the duration persisted in the Desktop policy (seven minutes and thirty seconds by default, bounded from one to sixty minutes) and stops both pools at the claim and last action boundary so no attempt is spent. Expiry keeps both pools blocked while exactly one Worker reloads its current trusted ChatGPT URL and runs the language-neutral structural health probe. Only an explicit `rateLimited=false` result with no authentication, verification or access gate releases the queue; fresh rate-limit evidence opens another configured suspension, while an ambiguous surface defers another probe. A later observation never shortens an active suspension. Residence, rotation position, the navigation tail and the recent-refusal window remain ephemeral Desktop state.

Rate-limit scope amendment: the durable 429 state suspends only ordinary Worker claims and Worker provider actions. Supervisor and Translator claims remain eligible and their provider actions do not consult the Worker resume gate; rate-limit evidence they observe still updates the same durable Worker backoff. Expiry keeps Workers blocked while exactly one Worker reloads its current trusted ChatGPT URL and performs the language-neutral health probe. This paragraph supersedes the broader “whole provider” and “both pools” scope in the preceding historical description. Manual Worker suspension uses the same pre-attempt claim boundary and may exclude every ordinary Worker type or a validated selected set. Account-maintenance and title tasks are selectively suspended by default; classification remains eligible unless the operator selects it.

Desktop window ids and the shell's bound/active project state are persisted locally. In stack mode, self-evolution stages replacement images while the old stack remains live, then hands backend/frontend activation to a detached supervisor container that is outside the backend container being replaced. PostgreSQL and the tunnel daemon are never part of that activation, and Desktop remains alive on the host. A failed application rollout restores the previous backend/frontend image IDs before source rollback/rebuild proceeds. The UI retains restart-all, current-self-evolution-first, or later semantics for the pending transaction, and window/project bindings remain preserved.

## Durable ChatGPT artifact library (v1.3)

The canonical Compose stack includes an internal MinIO service with a dedicated
named volume. The backend owns an application-level artifact object-store port;
the MinIO/S3 adapter is infrastructure and MUST NOT leak into domain types or
frontend transport. Session records keep public artifact metadata (request,
direction, kind, filename, size, digest, timestamps and ZIP entry count) while
the MinIO object key remains server-only persistence metadata.

Wharness persists request input bundles, result bundles and their exchanged
attachment/artifact files at the transport seams. Desktop-local attachment
copies remain a conversation UX cache and do not replace the MinIO artifact
library. Output bundles are persisted before normal result handling once they
are associated with the pending request. ZIP inspection reads the persisted
object and never extracts it into the target project.

Artifact retention is global Wharness configuration stored below the existing
state directory. The default is 30 days. A startup cleanup plus a periodic
backend cleanup removes expired objects and metadata; changing the retention
setting applies the new cutoff immediately. Explicit session/data deletion also
removes owned artifact objects. Normal stack stop/down preserves the MinIO named
volume just like the other durable stack services.

## Chat archive lifecycle and compaction (v1.4)

Closing a Harness chat archives its backend Session and is an instant,
idempotent state flip (`archived_at`) — it never itself does heavy work. A
passive, throttled sweep (see ADR-0031) later folds every backend-owned
artifact still attached to that session — its MinIO artifacts, its
`harness_events` audit/log rows, and any still-present on-disk context
archive files — into one package, compressed with the pure-Go
`klauspost/compress/zstd` library's best-compression mode, and uploads it to
MinIO through the same artifact object-store port. Only once that upload is
confirmed does the sweep delete the originals it now covers; a session whose
deletes are still failing stays parked, retried on the next sweep tick,
never advancing past that checkpoint until the destructive step after it has
confirmed success. The chat's human-readable transcript is out of scope for
this pipeline: it remains a frontend-local concern, unaffected by session
archive/compaction state.

Restoring a chat is bimodal. Within a configurable grace period (default 72
hours) after archiving, the session has not yet been compacted, so restoring
is the same kind of instant state flip as archiving — the backend never
touched the session's data. Once the sweep has compacted it, restoring must
instead download the package, verify its digest, unpack it, and re-upload
every artifact and re-append every event before the session is usable again;
only after all of that fully succeeds does the session commit as restored
and the package get deleted. The sweep itself runs strictly one session at a
time, never concurrently, with a short pause between sessions — Go has no
portable OS thread-priority API, so this bounded, sequential processing is
the mechanism behind keeping compaction from monopolizing backend resources,
not an OS-level priority grant.

## Project Orchestrator (v1.4)

Orchestrator is a project-level application capability, not a second executor. Its architectural flow is:

`Objective -> orchestrator proposal -> durable Plan/Task DAG -> approval/readiness -> Agent Session -> existing execution pipeline`

The proposal contract is `harness.orchestrator-plan/v1` and contains planning metadata only. Planner adapters may produce it automatically. When the configured adapter produces a manual prompt, the backend MUST first persist that request as a highest-priority durable `ORCHESTRATOR_PLAN` browser-agent task; a hidden Worker requests one exact task-scoped JSON artifact and imports it through the same validator. Leaving Orchestrator or restarting Desktop MUST NOT lose the request. Manual copy/paste remains an explicit fallback after delivery trouble. Neither path may use the Orchestrator protocol to execute commands.

Durable Orchestrator Plans, Tasks, dependency edges and TaskRuns are stored project-scoped in PostgreSQL and are independent from chat Session lifecycle. Transport handlers resolve project scope through an existing Session, while the application service and `internal/orchestrator` package own validation, readiness and persistence.

A task Start action creates a normal Agent Session and submits one normal Agent request. All model-produced mutations therefore continue through Policy, Protected verification, ChangeSet integration and Apply. There is no `AI -> Orchestrator -> shell` path.

## Application utility engine

Wharnex has a dedicated non-executing utility boundary for AI-assisted application features such as document translation. `harness.utility/v1` is that boundary's application port — the shape a Wharnex surface asks in and is answered in — and never reaches the provider. `translate_markdown` is executed through the durable Desktop queue rather than a direct external-model API adapter: the backend's `internal/translation` engine builds a `wharness.translation-input/v1` request bundle and enqueues a highest-priority, single-attempt `TRANSLATE_MARKDOWN` task. A dedicated ephemeral Translator creates a hidden hardened browser instance, uploads that archive, returns the downloaded `harness.translation/v1` response bundle unopened, then destroys the instance. Persistent Workers cannot claim this type. The same engine validates it fail-closed against the request it answers before any byte is used (see `adr/ADR-0052`). The transport holds no protocol knowledge beyond size bounds and an exact expected filename.

The utility boundary is intentionally disjoint from `AI -> Plan -> Policy -> Runner -> Apply`. Utility requests cannot carry commands or patches and never create a ChangeSet. The Translator uploads the Markdown as untrusted data and retrieves translation only through one exact bounded UTF-8 `.md` artifact; it never reads assistant response prose. The HTTP adapter may dispatch it only for an existing Session and applies feature-specific configuration checks before the task. Worker rate-limit suspension does not delay or cancel Translator work. Any transport/auth/provider failure is terminal on the first attempt and is surfaced inline as “A tradução falhou. Tente novamente mais tarde.”

Global language preferences are a small state-directory document (`language-settings.json`) owned by the config layer. Version 1 admits only Portuguese, English and French and requires at least one translation target. Frontend Markdown renderers consume those preferences through the HTTP API and hold translated Markdown only in local viewer state, so project/domain persistence continues to contain the original source exclusively.

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
- `services/webapp`: independent React + Tailwind paired remote-management application, with its own dependency graph/build and served only on the private Compose network; it does not compile or import the Desktop frontend.
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

### Session residency (v1.3.38)

PostgreSQL is authoritative; the in-process session map is a residency cache and MUST stay bounded by recent use, not by how many sessions were ever created. Every session is resident as a slim scan view without its context file list (`context.manifest.files`), per-request knowledge snapshots and baseline file snapshots; only a least-recently-used set, bounded by count and by stored payload bytes, is resident whole. Startup MUST load the slim projection server-side instead of transferring and decoding every aggregate. `Get` and `Update` MUST always return the whole session, hydrating from PostgreSQL on demand, and a write MUST NEVER persist a slim view over the durable aggregate. `List` is a scan: a caller that reads one of the stripped fields, or hands a scanned session to request, knowledge, baseline or Apply logic, MUST first `Get` it.

### Tunnel daemon boundary

The backend MUST NOT own tunnel process lifetime in stack mode. It communicates with the dedicated tunnel daemon over an internal Docker-network HTTP API authenticated with a generated local bearer token. The daemon owns provider processes, provider credentials, request-channel storage, retention and public URL lifetime. Backend shutdown/replacement therefore cannot call provider session stop. Normal lifecycle reconciliation MUST preserve the tunnel container. Explicit `stack-stop`/`stack-down` may terminate it and consequently invalidate ephemeral URLs.

Backend-created context/sandbox temporary files used by the host Docker daemon or tunnel daemon live under a host-visible `.harness/bridge` mounted at the same absolute pathname. The tunnel daemon accepts publication source paths only from this bridge and copies them into its own persistent volume before exposing them.

### Gateway and paired remote-management boundary

The canonical stack has one host-facing application ingress: `services/gateway`. Its local listener routes same-origin `/api/` requests to the backend and all other routes to the local frontend. Backend, local frontend and remote webapp have no host-published application ports. Desktop therefore targets only the gateway origin in stack mode. Internal database, object-store and tunnel-daemon control endpoints remain on their existing private boundaries and are not made browser-facing by the gateway.

The tunnel daemon may expose a second, private gateway listener through an already-configured public tunnel. That listener serves the independent remote webapp and same-origin backend API, but it is not itself host-published. Browser/Supervisor `WebContentsView` instances remain owned and executed only by Desktop; the remote webapp is a control surface over the existing backend/Desktop orchestration and MUST NOT create a second browser runtime. The public tunnel continues to own exact request-channel and stored-object routes before proxying ordinary application paths, so remote management cannot shadow or enumerate those capability URLs.

Remote-management authorization is an explicit pairing seam described in `SoT/SECURITY_MODEL.md` and `adr/ADR-0071`. A gateway-added remote marker distinguishes the public ingress from local same-origin traffic; the local listener clears that marker rather than trusting browser-supplied values. The backend alone creates and validates pairing/session credentials.
## Desktop multi-window and multi-project composition

The Electron main process owns a registry of desktop windows and canonical project-path leases. A canonical project path may be bound to at most one desktop window at a time; attempts from another window fail closed and may focus the owning window. This lease is a UI/runtime ownership boundary and does not weaken backend project containment or execution policy.

Each desktop window hosts a trusted local **workspace shell**. The shell may bind multiple projects and keeps one same-origin project renderer frame mounted per binding. Project selection changes visibility rather than remounting the project application, preserving React state, active requests, editor surfaces and page state during ordinary project switching. Each project renderer still creates/uses backend sessions scoped to its own `project_path`.

Remote ChatGPT rendering is process-global per authenticated profile: exactly six Supervisor `WebContentsView` slots exist, physically hosted in the browser host window and mirrored one at a time into the active Wharnex window's Engine pane, and a bounded pool of one to three persistent worker views (three by default), hidden by default, executes the small durable browser-agent jobs. The Worker pool can be resized at runtime; scale-down is non-preemptive and retires an excess renderer only after its current task settles and any explicit local interaction has ended. Chats persist a canonical provider `conversation_id`; renderer slots remain affinity caches and are not chat ownership.

A Supervisor slot is bound to one Harness chat for the life of its request (see `adr/ADR-0049`). It opens the conversation, submits the request bundle, follows the remote instance in real time and collects the response bundle, and it releases that chat only once it holds nothing unfinished *and* another chat is waiting for a slot. Selecting a resident chat is therefore a visibility change, not a navigation — which matters because every cross-chat load is a real authenticated provider request, and a two-slot pool serving many chats re-navigated on each switch with no work attached to it. A transport active in one Supervisor may defer only a target that actually needs that same held physical capacity; it MUST NOT cover a chat resident in another Supervisor, a free slot, or a proven-releasable slot. The Engine identifies a bound chat's real slot as `Supervisor N` using narrow Desktop-owned runtime metadata. The durable queue is partitioned by pool role at the claim: Supervisors take `AWAIT_RESPONSE`, `BOT_WRITE` and `RECOVERY_WRITE`; persistent Workers take account, title, classification, release-notes and `ORCHESTRATOR_PLAN` work; the ephemeral Translator takes only `TRANSLATE_MARKDOWN`. Orchestrator planning uses a temporary Worker conversation and one request/response ZIP pair. The Translator uses the hardened Worker transport boundary for compatibility, but creates its hidden WebContents only after a translation claim and destroys it when that single task settles. Small jobs can never be dispatched to the Supervisor pool, and the Supervisor remains the normal human chat surface. The Agent runtime drawer MAY temporarily surface exactly one idle Worker as an interactive mirror for explicit local interaction or route that same mirror into the main Engine area through **Seguir (flow)** without changing scheduler ownership or navigation authority; the dedicated browser monitor may present one selected running Worker with a compensated effective viewport so automation retains its expected layout. The surfacing ends on exit, renderer failure, or window close. PostgreSQL persists typed task state and leases, and the runtime drawer reconciles Worker occupancy from current `LEASED`/`RUNNING` lease owners so Desktop/UI refreshes do not lose busy state.

Every Supervisor and Worker `WebContentsView` lives, from creation to close, inside its own container `View` in one process-global **browser host** window: mapped but one pixel, unfocusable, click-through and off the taskbar. Two measured Electron 44 Linux constraints fix that shape. A view in a window that is hidden or was never shown has no compositor surface, so it cannot be captured; and a `WebContentsView` that was sized while attached at a non-zero window offset never repaints once it is re-parented. The content view is therefore sized only at the host origin (with a synchronous show/resize/hide, which also recreates a surface a parked navigation dropped) or while its container is out of any window; only the container is moved and positioned. Project windows never hold a ChatGPT view. The Desktop still drives `entry.view` as the project's Engine surface: a hosted surface records the requested pane bounds and visibility, gives the real view the same size so the page lays out for that pane, and reports real compositing through `getVisible()` so automation keeps choosing its hidden-surface input route.

A project window shows its Engine Supervisor, or the one Worker it surfaced, as a live mirror fed by a stream. The main process keeps one stream per agent view, shared by every pane subscribed to it: a pane subscribes explicitly and receives its own `MessagePort`, and only the window that owns the chat, or that surfaced the Worker, is granted one, re-checked while the subscription lives. The stream is driven by the view's own paints through a frame subscription, so a page that does not repaint sends nothing; paints are coalesced and JPEG-encoded once for all subscribers at a bounded rate that rises briefly after the user's input. A single capture seeds a new subscriber or a page that just navigated, and repaints a parked view whose surface was dropped. Delivery and JPEG encoding are credit-based: while no visible authorized subscriber can receive a frame, the stream retains only the latest unencoded paint and performs no JPEG work. Acknowledgement schedules that latest paint at the existing bounded cadence before delivering it; an already encoded seed is reused for a new subscriber until navigation or capture suspension invalidates it. A pane receives the next frame only after acknowledging that it drew the previous one, frames are decoded straight into a canvas, and capture stops while no subscriber's window is showing and when the last subscriber closes its port. The user's own pointer, wheel and key events on the mirror are forwarded to that one view over its debugger, from a closed vocabulary with coordinates normalized to the mirrored image; key text and editing commands (copy, paste, select all, undo, redo) are derived in the main process. The IPC accepts input only from the trusted window that owns the chat or surfaced the Worker.

The tray exposes one process-global browser monitor window independent of project windows; closing it sends it to the background and the tray brings it back, optionally selecting an instance. Its list and task details come from the bounded Agent runtime projection, including Supervisor slots, persistent Workers and ephemeral utility Workers, and it also manages the runtime policies (provider protection, pool capacity, Worker automation) with the same controls as the Agent drawer. Selecting an instance moves its container from the host into the monitor pane, sizing the content only while the container is detached, so the user sees and drives the real browser; switching, closing or a monitor renderer suspension returns it to the host at its project pane size. Presenting never creates another browser, navigates, inspects response prose, or changes task ownership, leases or affinity, and only one instance is presented at a time. A Worker is presented at its own content size, cropped or padded by its container, so its automation layout never changes; zoom cannot be used for that because Chromium shares a zoom level across every view of an origin, so agent views always render at zoom 1. A view newly attached to the monitor shows nothing until its renderer produces a new frame, which a page that is not repainting never does on its own, so presenting and resizing force one with a visible one-pixel capture. The monitor IPC accepts only its own trusted local window and a canonical existing agent id. The passive snapshot endpoint captures any agent where its view is parked.
That one queue serves every project, so a task's owning project is a first-class durable field: the canonical absolute host project path, resolved by the store at enqueue from a supplied absolute path, else from the task's own workspace chat, else from its session (see `adr/ADR-0044`). A ChatGPT project display name is never that identity. The renderer pool stays process-global and shared across projects; what is scoped per project is the claim. The Desktop passes the set of projects currently open in some window, and the durable claim admits a task only when the caller did not scope by project, or the task has no project attribution, or its project is open, or it is account-lifecycle work — `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_BUNDLE`, `DELETE_TEMP_CHAT` — which acts on the ChatGPT account rather than the project and MUST converge whatever is open. Scoping is a claim predicate, never a claim followed by a release: a claim charges an attempt. Closing a project admits nothing new and interrupts nothing already leased.

Worker routing uses transient slot residency on top of that durable queue. After a Worker reaches a conversation it keeps that lane for a 60-second default dwell (configurable down to 30 seconds), but ordinary queued work claims by global priority and FIFO across open projects; only live response supervision and explicit operator pins retain lane precedence. Every autonomous Worker action that can reach ChatGPT — navigation, reload, upload attempt, submit, and account-lifecycle action — shares one profile-global pacing gate derived from durable 429 evidence; this is independent of slot residency and excludes Supervisor actions. The bounded artifact-only `TRANSLATE_MARKDOWN` utility has a separate five-second minimum cadence and may use an idle persistent Worker or one temporary Translator per pending translation. Assignment epochs reject stale post-navigation callbacks, while physical-slot transport serialization prevents work from the prior resident lane overlapping a rebind. Request-bound follow-up jobs have a durable adaptive eligibility time with a one-minute floor; the estimate uses at most the latest 50 structurally observed ChatGPT processing-duration disclosures from already validated canonical bundles. Provider rate-limit state is durable and carries a kind. ChatGPT's own limit control, detected structurally in the page DOM, is the only rate-limit evidence (an HTTP 429 from any endpoint is a logged diagnostic only); it suspends the whole provider for the duration persisted in the Desktop policy (seven minutes and thirty seconds by default, bounded from one to sixty minutes) and stops both pools at the claim and last action boundary so no attempt is spent. Expiry keeps both pools blocked while exactly one Worker reloads its current trusted ChatGPT URL and runs the language-neutral structural health probe. Only an explicit `rateLimited=false` result with no authentication, verification or access gate releases the queue; fresh rate-limit evidence opens another configured suspension, while an ambiguous surface defers another probe. A later observation never shortens an active suspension. Residence, rotation position, the navigation tail and the recent-refusal window remain ephemeral Desktop state.

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

The proposal contract is `harness.orchestrator-plan/v1` and contains planning metadata only. Planner adapters may produce it automatically. When the configured adapter produces a manual prompt, the backend MUST first persist that request as a highest-priority durable `ORCHESTRATOR_PLAN` browser-agent task; a hidden Worker uploads one request ZIP and imports one exact response ZIP through the same validator. Leaving Orchestrator or restarting Desktop MUST NOT lose the request. Already checkpointed legacy JSON deliveries remain readable. Manual copy/paste remains an explicit fallback after delivery trouble. Neither path may use the Orchestrator protocol to execute commands.

Durable Orchestrator Plans, Tasks, dependency edges and TaskRuns are stored project-scoped in PostgreSQL and are independent from chat Session lifecycle. Transport handlers resolve project scope through an existing Session, while the application service and `internal/orchestrator` package own validation, readiness and persistence.

A task Start action creates a normal Agent Session and submits one normal Agent request. All model-produced mutations therefore continue through Policy, Protected verification, ChangeSet integration and Apply. There is no `AI -> Orchestrator -> shell` path.

## Application utility engine

Engine amendment (`adr/ADR-0081`, implemented): an Orchestrator task is one agentic Main Request. Its `ORCHESTRATOR_EXECUTE` attempt only drives rounds, and sends each pending request through the same `PREPARE_PROMPT` pipeline a chat uses. `AWAIT_RESPONSE` and `RECOVERY_WRITE` of a task chat (`otk_…`) belong to the Workers, on the task lane `h:<task id>`. The Desktop delivers the task's response bundle straight to `POST /api/orchestrator/tasks/{task_id}/bundle`. The task keeps one durable ChatGPT conversation for its whole life, across rounds, repairs, attempts and retries. Pool amendment (`adr/ADR-0082`, supersedes the Worker placement of planning, release notes and translation above): persistent Workers never claim `TRANSLATE_MARKDOWN`, `ORCHESTRATOR_PLAN` or `RELEASE_NOTES`. Those three belong to the ephemeral utility pool (role `translator`), which keeps one claim loop per due or running task, never counts free Workers as capacity, and gives each task its own hidden browser. That browser lives until the task settles (a translation after its single request), so a WAITING plan keeps its conversation open. A persistent Worker that runs an `ORCHESTRATOR_EXECUTE` attempt stays pinned to that task's lane until an attempt ends DONE, FAILED or ATTENTION, or the lane stays silent for 15 minutes. It claims only that lane, other Workers exclude it, and auto scale does not count it as free. The configured Worker count and auto scale therefore serve Orchestrator execution. Historical text: an idle persistent Worker may claim a translation before other Worker work. The Translator scheduler supplies one ephemeral claim loop per translation that exceeds eligible free Worker capacity, plus one per translation already running there (within the canonical `translator-N` id range), independently of the persistent Worker maximum and Worker suspension. Each ephemeral translation owns its browser until its exact response bundle settles; the browser is then destroyed. The global translation pacer still separates provider actions.

Wharnex has a dedicated non-executing utility boundary for AI-assisted application features such as document translation. `harness.utility/v1` is that boundary's application port — the shape a Wharnex surface asks in and is answered in — and never reaches the provider. `translate_markdown` is executed through the durable Desktop queue rather than a direct external-model API adapter: the backend's `internal/translation` engine builds a `wharness.translation-input/v1` request bundle and enqueues a highest-priority, single-attempt `TRANSLATE_MARKDOWN` task. A dedicated ephemeral Translator creates a hidden hardened browser instance, uploads that archive, returns the downloaded `harness.translation/v1` response bundle unopened, then destroys the instance. Idle persistent Workers may claim this type; ephemeral Translators cover any shortage. The same engine validates it fail-closed against the request it answers before any byte is used (see `adr/ADR-0052`). The transport holds no protocol knowledge beyond size bounds and an exact expected filename.

The utility boundary is intentionally disjoint from `AI -> Plan -> Policy -> Runner -> Apply`. Utility requests cannot carry commands or patches and never create a ChangeSet. The Translator uploads the Markdown as untrusted data and retrieves translation only through one exact bounded UTF-8 `.md` artifact; it never reads assistant response prose. The HTTP adapter may dispatch it only for an existing Session and applies feature-specific configuration checks before the task. Worker rate-limit suspension does not delay or cancel Translator work. Any transport/auth/provider failure is terminal on the first attempt and is surfaced inline as “A tradução falhou. Tente novamente mais tarde.”

Global language preferences are a small state-directory document (`language-settings.json`) owned by the config layer. Version 1 admits only Portuguese, English and French and requires at least one translation target. Frontend Markdown renderers consume those preferences through the HTTP API and hold translated Markdown only in local viewer state, so project/domain persistence continues to contain the original source exclusively.

## Browser monitor chat links

The monitor's **Links GPT** tab lists durable created conversations from workspace chats and Orchestrator planning/execution tasks across projects, with their recorded titles (`adr/ADR-0090`). The earlier no-creation/no-navigation rule applies to presenting an existing Agent instance. Selecting a link already loaded by a Supervisor or Worker presents that instance; otherwise an explicit local click MAY create one short-lived, human-only ChatGPT view using the dedicated partition and the same renderer isolation settings. This view is not an Agent slot, has no task, transport, account-automation or content-observation listeners, and does not change affinity. At most one exists per monitor; switching links or suspending the monitor closes it. Its initial navigation is restricted to the selected canonical conversation URL. The backend catalog is read-only. Each selection shows instance-style metadata and owner-scoped exchanged bundles as the last detail section. Opening the bundle explorer releases the native browser surface before drawing the modal.

The persistent Compose backend MUST run behind Docker’s init (`init: true`).
The backend receives a 30 s shutdown grace for its bounded HTTP shutdown and
asynchronous log drain. The init owns PID 1, forwards lifecycle signals, and reaps orphaned toolchain/Git
descendants after their parent exits or times out. Backend code MUST continue
to wait for its own direct children; a global Go `waitpid(-1)` reaper is forbidden
because it can steal an executor’s exit status. Enabling init changes no planner,
executor, sandbox or durable-task authority.

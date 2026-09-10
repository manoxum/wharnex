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

`Change Plan -> Policy -> Sandbox Execute -> Verify -> Explicit or Auto-approved Host Apply`

The iterative evidence branch is bounded and non-mutating on the host:

`Workflow Plan -> Policy -> Disposable Protected Sandbox -> Structured Observations -> Refreshed Context -> Same Planner Conversation -> next Agent Turn`

There is no direct `AI -> shell` path. MCP, when introduced, is an adapter behind application ports rather than a route around Policy/sandbox boundaries.

## Services

- `services/frontend`: React user experience, served by the persistent Compose stack.
- `services/backend`: Go API/orchestrator, executed in Compose and connected to the host Docker daemon only as the trusted owner of Protected runner creation.
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
## Desktop multi-window and multi-project composition

The Electron main process owns a registry of desktop windows and canonical project-path leases. A canonical project path may be bound to at most one desktop window at a time; attempts from another window fail closed and may focus the owning window. This lease is a UI/runtime ownership boundary and does not weaken backend project containment or execution policy.

Each desktop window hosts a trusted local **workspace shell**. The shell may bind multiple projects and keeps one same-origin project renderer frame mounted per binding. Project selection changes visibility rather than remounting the project application, preserving React state, active requests, editor surfaces and page state during ordinary project switching. Each project renderer still creates/uses backend sessions scoped to its own `project_path`.

Remote ChatGPT rendering is process-global per authenticated profile: exactly one visible Supervisor `WebContentsView` is attached to the active Wharnex window and three hidden persistent worker views execute durable browser-agent jobs. Chats persist a canonical provider `conversation_id`; renderer slots are transient execution/affinity caches and are not chat ownership. Background jobs can never be dispatched to the Supervisor. PostgreSQL persists typed task state and leases so Desktop restart does not lose or duplicate autonomous work.

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

The proposal contract is `harness.orchestrator-plan/v1` and contains planning metadata only. Planner adapters may produce it automatically or as a manual copy/paste prompt, but they MUST NOT use the Orchestrator protocol to execute commands.

Durable Orchestrator Plans, Tasks, dependency edges and TaskRuns are stored project-scoped in PostgreSQL and are independent from chat Session lifecycle. Transport handlers resolve project scope through an existing Session, while the application service and `internal/orchestrator` package own validation, readiness and persistence.

A task Start action creates a normal Agent Session and submits one normal Agent request. All model-produced mutations therefore continue through Policy, Protected verification, ChangeSet integration and Apply. There is no `AI -> Orchestrator -> shell` path.

## Application utility engine

Wharnex has a dedicated non-executing utility boundary for AI-assisted application features such as Markdown translation. `internal/utility.Engine` is an application-facing port whose requests/results use `harness.utility/v1`; infrastructure adapters such as `internal/utility/openai` may call an external model provider, but they do not depend on the planner or execution pipeline.

The utility boundary is intentionally disjoint from `AI -> Plan -> Policy -> Runner -> Apply`. Utility requests cannot carry commands or patches and never create a ChangeSet. The HTTP adapter may invoke it only for an existing Session and applies feature-specific configuration checks before the call. Provider absence is surfaced to the UI as capability unavailability.

Global language preferences are a small state-directory document (`language-settings.json`) owned by the config layer. Version 1 admits only Portuguese, English and French and requires at least one translation target. Frontend Markdown renderers consume those preferences through the HTTP API and hold translated Markdown only in local viewer state, so project/domain persistence continues to contain the original source exclusively.

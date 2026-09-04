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

- `services/frontend`: React user experience.
- `services/backend`: Go API/orchestrator.
- `docker/runner`: execution environment.
## Desktop multi-window and multi-project composition

The Electron main process owns a registry of desktop windows and canonical project-path leases. A canonical project path may be bound to at most one desktop window at a time; attempts from another window fail closed and may focus the owning window. This lease is a UI/runtime ownership boundary and does not weaken backend project containment or execution policy.

Each desktop window hosts a trusted local **workspace shell**. The shell may bind multiple projects and keeps one same-origin project renderer frame mounted per binding. Project selection changes visibility rather than remounting the project application, preserving React state, active requests, editor surfaces and page state during ordinary project switching. Each project renderer still creates/uses backend sessions scoped to its own `project_path`.

Remote ChatGPT renderers remain one `WebContentsView` per Harness chat. In multi-window mode every view additionally carries the stable owner-window id; bounds, visibility, download/auth events and DOM IPC are routed only through that owner. A view may never migrate between windows or Harness chats.

Desktop window ids and the shell's bound/active project state are persisted locally. Self-evolution remains a process-level transactional host restart; the UI exposes restart-all, current-self-evolution-first, or later. Window/project bindings are restored after the process handoff so non-selected windows return to their previous project composition instead of being collapsed into one workspace.

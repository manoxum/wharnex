# ADR-0032 — Project Orchestrator mode

## Status

Accepted.

## Context

Wharnex has Editor for direct source work and Agent for one conversational request chain, but neither surface models a larger project objective as durable work. Users need to describe an outcome once, review its decomposition, approve it, and then supervise a dependency-aware queue of tasks across multiple Agent runs.

Putting this state inside one Agent Session would couple project planning to a chat lifecycle, make dependencies difficult to inspect across chats, and tempt a second execution path around the existing Policy/Protected/Apply pipeline.

## Decision

Wharnex adds **Orchestrator** as a third first-class workspace mode. The responsibility split is explicit:

`User objective -> Planner -> Draft Plan + Tasks -> User decision (approve/reject/revise) -> Orchestrator -> Agent task run`

The Planner decomposes work only. It returns `harness.orchestrator-plan/v1`, a task DAG with acceptance criteria, dependencies, priority, capability/complexity and expected impact/read/barrier files. It never emits shell commands for this protocol. A manual planner result is persisted before the proposal call returns as a highest-priority `ORCHESTRATOR_PLAN` browser-agent task. A hidden Worker requests the exact canonical response bundle and imports it through the normal validator; mode changes and Desktop restart reclaim the durable task. The Orchestrator reuses the Agent `ChatPanel` composer for intake, so selected context, file references, attachments and project-level composer controls do not fork into a second UI implementation. The retained prompt/manual-import path remains a recovery fallback when automated delivery cannot complete.
The wire contract is documented by `schemas/orchestrator-plan.schema.json`; backend validation additionally enforces referential integrity and DAG acyclicity that JSON Schema alone cannot express.

The Orchestrator owns durable, project-scoped `Plan`, `Task`, `TaskDependency` and `TaskRun` records in PostgreSQL. They are not embedded inside `Session` JSON. Plans start `DRAFT`; generated tasks start `PENDING` with a plan-approval condition. The draft gate has three explicit decisions: approval activates the plan and moves dependency-satisfied root work to `READY`, while incomplete dependencies enter `WAITING`; rejection archives the draft plan and its tasks without executing them; revision archives/supersedes the current draft and creates a fresh planning request with the user's guidance plus the previous validated `harness.orchestrator-plan/v1` proposal as a bounded backend-generated attachment. Superseded/rejected drafts are not approvable.

Task lifecycle is `PENDING`, `WAITING`, `READY`, `DOING`, `REVIEW`, `FAILED`, `COMPLETE`, `ARCHIVED`. `PENDING` requires an explicit user release to `READY`; `WAITING` means a dependency is not complete and returns to `PENDING` when its dependencies complete. `READY` is eligible for a Worker claim. A separate condition records why a task is blocked or paused. `DOING` is special and can only be entered through the Orchestrator's Agent execution boundary after a Worker claim. The first persisted entry into `DOING` records monotonic `first_doing_at` evidence and becomes an irreversible manual-lifecycle barrier: neither drag/drop nor a lifecycle action may regress that task to `PENDING`, `WAITING` or `READY`, and `DOING`, `REVIEW` and `FAILED` remain execution-owned states rather than manual destinations.

`FAILED` retry is deliberately a different operation from reopening. An explicit retry may release the failed task internally for another Worker attempt while preserving `first_doing_at`, retry context, run history and the task's definitive conversation affinity; that internal release does not make the pre-execution states valid manual transitions again. `COMPLETE` is the terminal boundary of active work and may only move to `ARCHIVED`. `ARCHIVED` preserves the task as historical read-only context and never re-enters the active lifecycle. If completed work needs correction or extension, the operator creates a new task and may reference the completed/archived task rather than rewriting its history.

Claiming a `READY` task creates a dedicated normal Agent Session in Protected Auto mode. Each Orchestrator task owns one definitive immutable ChatGPT conversation: the first execution lease may establish its concrete URL/id, and every later request, repair, `FAILED` retry or reclaim by another Worker reuses that same binding. A Worker whose observed conversation diverges from the task binding, or whose backend bind/verification disagrees with it, fails closed before a second submit or continuation. The claiming Worker submits the session's request ZIP, remains on that conversation until the exact response ZIP downloads, and hands the bytes to the existing Agent bundle validator. Policy, Protected sandbox verification, informed approval where required, ChangeSet integration and recovery remain the only mutation authority. There is no Orchestrator-to-shell shortcut. Host-direct and Manual modes do not enter this automatic Worker path.

V1 exposes exactly **one mutation slot per canonical project** at the Protected execution/integration boundary. Browser Workers may hold independent leases and more than one task may be `DOING` while they wait on ChatGPT or local verification, but their Agent Sessions still enter the existing per-project execution FIFO and serialized host integration/Apply path. Worker concurrency therefore does not create a second project mutation authority. Raising the real mutation-slot count requires a separate concurrency decision and proof that integration/review semantics remain safe.

The UI has two Orchestrator pages backed by the same project-scoped source of truth:

- **Overview**: the shared Agent composer rendered in objective-only mode, draft-plan review with approve/reject/request-change decisions, active-slot indicator and operational metrics/recent tasks.
- **Tasks**: Kanban, table, list and dependency-graph views; manual task creation; task details/runs; and lifecycle actions. Kanban is a single horizontally scrollable, non-wrapping row of lifecycle columns including `ARCHIVED`; drag/drop requests backend transitions rather than becoming a client-side state authority, and visible actions come from backend-valid transitions. `COMPLETE` and `ARCHIVED` history is paged incrementally with authoritative total counts so the initial project payload remains bounded.

## Consequences

- Orchestrator state survives chat/session archival and can be inspected from any Session belonging to the project.
- A dedicated proposal protocol can evolve independently from `harness.execution/v1` without weakening its execution contract.
- The backend, not the React client, remains authoritative for DAG validity, readiness, transitions and mutation-slot admission.
- Manual planning remains supported without weakening structured validation: the user must import valid `harness.orchestrator-plan/v1` JSON before a plan exists.
- V1 is deliberately conservative about parallel mutation. Multiple objectives/tasks may be planned concurrently, but only one project mutation can execute at a time.

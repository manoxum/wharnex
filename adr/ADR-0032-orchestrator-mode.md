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

The Orchestrator owns durable, project-scoped `Plan`, `Task`, `TaskDependency` and `TaskRun` records in PostgreSQL. They are not embedded inside `Session` JSON. Plans start `DRAFT`; generated tasks start `PENDING` with a plan-approval condition. The draft gate has three explicit decisions: approval activates the plan and leaves dependency-satisfied work in `PENDING` for explicit user release, while incomplete dependencies enter `WAITING`; rejection archives the draft plan and its tasks without executing them; revision archives/supersedes the current draft and creates a fresh planning request with the user's guidance plus the previous validated `harness.orchestrator-plan/v1` proposal as a bounded backend-generated attachment. Superseded/rejected drafts are not approvable.

Task lifecycle is `PENDING`, `WAITING`, `READY`, `DOING`, `REVIEW`, `COMPLETE`, `ARCHIVED`. `PENDING` requires an explicit user release to `READY`; `WAITING` means a dependency is not complete and returns to `PENDING` when its dependencies complete. `READY` is eligible for a Worker claim. A separate condition records why a task is blocked or paused. The lifecycle is intentionally non-linear: completed/review work may be reopened, which invalidates downstream work whose dependency proof became stale. `DOING` is special and can only be entered through the Orchestrator's Agent execution boundary after a Worker claim.

Claiming a `READY` task creates a dedicated normal Agent Session in Protected Auto mode. The claiming Worker submits that session's request ZIP, remains on its conversation until the exact response ZIP downloads, and hands the bytes to the existing Agent bundle validator. Every continuation is a new request ZIP and response ZIP in the same durable run. Policy, Protected sandbox verification, informed approval where required, ChangeSet integration and recovery remain the only mutation authority. There is no Orchestrator-to-shell shortcut. Host-direct and Manual modes do not enter this automatic Worker path.

V1 exposes exactly **one mutation slot per canonical project**. The durable Worker claim excludes another Orchestrator execution in that project while a task is `DOING` or another execution lease owns the slot. The Agent request still passes through the existing project execution FIFO from ADR-0025. Parallelizable metadata is planning information only in V1. Raising the real mutation-slot count requires a separate concurrency decision and proof that integration/review semantics remain safe.

The UI has two Orchestrator pages backed by the same project-scoped source of truth:

- **Overview**: the shared Agent composer rendered in objective-only mode, draft-plan review with approve/reject/request-change decisions, active-slot indicator and operational metrics/recent tasks.
- **Tasks**: Kanban, table, list and dependency-graph views; manual task creation; task details/runs; and lifecycle actions. Kanban drag/drop requests backend transitions rather than becoming a client-side state authority.

## Consequences

- Orchestrator state survives chat/session archival and can be inspected from any Session belonging to the project.
- A dedicated proposal protocol can evolve independently from `harness.execution/v1` without weakening its execution contract.
- The backend, not the React client, remains authoritative for DAG validity, readiness, transitions and mutation-slot admission.
- Manual planning remains supported without weakening structured validation: the user must import valid `harness.orchestrator-plan/v1` JSON before a plan exists.
- V1 is deliberately conservative about parallel mutation. Multiple objectives/tasks may be planned concurrently, but only one project mutation can execute at a time.

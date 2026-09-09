# ADR-0032 — Project Orchestrator mode

## Status

Accepted.

## Context

Wharnex has Editor for direct source work and Agent for one conversational request chain, but neither surface models a larger project objective as durable work. Users need to describe an outcome once, review its decomposition, approve it, and then supervise a dependency-aware queue of tasks across multiple Agent runs.

Putting this state inside one Agent Session would couple project planning to a chat lifecycle, make dependencies difficult to inspect across chats, and tempt a second execution path around the existing Policy/Protected/Apply pipeline.

## Decision

Wharnex adds **Orchestrator** as a third first-class workspace mode. The responsibility split is explicit:

`User objective -> Planner -> Draft Plan + Tasks -> User approval -> Orchestrator -> Agent task run`

The Planner decomposes work only. It returns `harness.orchestrator-plan/v1`, a task DAG with acceptance criteria, dependencies, priority, capability/complexity and expected impact/read/barrier files. It never emits shell commands for this protocol. The manual planner adapter exposes the same protocol as a copy/paste JSON fallback.
The wire contract is documented by `schemas/orchestrator-plan.schema.json`; backend validation additionally enforces referential integrity and DAG acyclicity that JSON Schema alone cannot express.

The Orchestrator owns durable, project-scoped `Plan`, `Task`, `TaskDependency` and `TaskRun` records in PostgreSQL. They are not embedded inside `Session` JSON. Plans start `DRAFT`; generated tasks start `PENDING` with a plan-approval condition. Approval activates the plan and a deterministic readiness evaluator moves dependency-satisfied work to `READY`.

Task lifecycle is `PENDING`, `READY`, `DOING`, `REVIEW`, `COMPLETE`, `ARCHIVED`. A separate condition records why a task is blocked or paused. The lifecycle is intentionally non-linear: completed/review work may be reopened, which invalidates downstream work whose dependency proof became stale. `DOING` is special and can only be entered by the Orchestrator Start action.

Starting a `READY` task creates a dedicated normal Agent Session and submits the task through the existing Agent application path. Policy, Protected sandbox verification, explicit/automatic Apply, ChangeSet integration and recovery therefore remain the only mutation authority. There is no Orchestrator-to-shell shortcut.

V1 exposes exactly **one mutation slot per canonical project**. The Orchestrator refuses a second `DOING` task while one is active, and the Agent request still passes through the existing project execution FIFO from ADR-0025. Parallelizable metadata is planning information only in V1. Raising the real mutation-slot count requires a separate concurrency decision and proof that integration/review semantics remain safe.

The UI has two Orchestrator pages backed by the same project-scoped source of truth:

- **Overview**: a spacious objective composer, draft-plan review/approval, active-slot indicator and operational metrics/recent tasks.
- **Tasks**: Kanban, table, list and dependency-graph views; manual task creation; task details/runs; and lifecycle actions. Kanban drag/drop requests backend transitions rather than becoming a client-side state authority.

## Consequences

- Orchestrator state survives chat/session archival and can be inspected from any Session belonging to the project.
- A dedicated proposal protocol can evolve independently from `harness.execution/v1` without weakening its execution contract.
- The backend, not the React client, remains authoritative for DAG validity, readiness, transitions and mutation-slot admission.
- Manual planning remains supported without weakening structured validation: the user must import valid `harness.orchestrator-plan/v1` JSON before a plan exists.
- V1 is deliberately conservative about parallel mutation. Multiple objectives/tasks may be planned concurrently, but only one project mutation can execute at a time.

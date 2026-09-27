# Wharnex Domain

Wharnex coordinates durable AI-assisted project work while keeping planning, execution, and host mutation explicitly separated.

## Language

**Harness Session**:
The durable aggregate for one backend conversation and its context, plan, policy, execution, and recovery state.
_Avoid_: Backend session blob, workspace file

**Session Store**:
The authoritative collection of Harness Sessions, addressed by stable session identity.
_Avoid_: Sessions JSON, state file

**Legacy Session Snapshot**:
A former whole-store representation that may seed an empty Session Store once but is never authoritative afterward.
_Avoid_: Active JSON database, fallback store

**Main Request**:
The root user goal that owns every standard, repair, evidence, and conflict-resolution iteration until completion or cancellation.
_Avoid_: Latest request, current prompt

**Request Iteration**:
One correlated exchange within a Main Request, classified as standard work, error repair, local evidence extraction, or conflict resolution.
_Avoid_: Retry, random follow-up

**Retained ChangeSet Conflict**:
A conflict raised when a previously verified Protected candidate can no longer be replayed onto the current project baseline.
_Avoid_: Planner failure, generic repair failure

**Orchestrator Task**:
A durable unit of planned project work with explicit dependencies and its own run history.
_Avoid_: Browser Worker lease, Main Request

**Orchestrator Readiness**:
`PENDING` is a manual hold, `WAITING` has an unmet dependency, and `READY` may be claimed by a Worker.
_Avoid_: Treating a queued Worker lease as task readiness

**Orchestrator Failure**:
`FAILED` is a terminal run outcome that retains its error until the user explicitly retries the task.
_Avoid_: Returning a failed run to `PENDING`

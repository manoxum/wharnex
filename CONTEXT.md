# Wharness Domain

Wharness coordinates durable AI-assisted project work while keeping planning, execution, and host mutation explicitly separated.

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

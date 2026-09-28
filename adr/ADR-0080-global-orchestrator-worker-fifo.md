# ADR-0080 — Global Worker FIFO for Orchestrator tasks

- Status: Accepted
- Supersedes: the single Orchestrator mutation slot in `SoT/EXECUTION_MODEL.md` v1.4.
- Related: `adr/ADR-0025`, `adr/ADR-0049`, `adr/ADR-0079`.

## Context

Several READY tasks in one project remained unclaimable while Workers were
idle. The browser queue guarded every other execution behind a project-wide
DOING task, although each Worker uses an isolated Agent Session and Protected
runner. The UI counted that backlog as READY while displaying one mutation
slot, which obscured why Auto scale could not use free Workers.

## Decision

Workers claim from one global durable queue across open projects. Translation
has the highest priority, Orchestrator planning comes next, and Orchestrator
execution follows. Within each priority band, creation time and task id give
FIFO order. Ordinary conversation residency may save navigation, but cannot
reorder this queue; live response ownership and explicit operator pins remain
non-preemptive exceptions.

READY executions from the same project may be claimed by separate Workers and
enter DOING concurrently. The default Protected execution admission capacity
is five per project and remains operator adjustable. Verification runs in
isolated copies; host integration retains its project lock and conflict checks.
Dependency readiness and strict bundle validation still apply to every task.

Every Orchestrator card exposes its reasoning effort. An update during DOING
also updates the task's Agent Session for its next provider request; a request
already submitted retains the effort it used. Terminal-task effort is metadata
for any future authorized run and does not restart work by itself.

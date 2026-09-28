# ADR-0080 — Global Worker FIFO for Orchestrator tasks

- Status: Accepted; amended by `adr/ADR-0082` (translation and planning left the Worker queue; execution Workers stay pinned to their task)
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

Every Orchestrator card exposes its effort level: the composer's autonomous
attempt budget (Low · 3 through Ultra · 50) that the task's Agent run may
spend before the task fails. Loop is not a task level, because a task must
end in FAILED once its budget is spent; a task without its own level inherits
the owning session's, with Loop bounded to Ultra. The task drawer also keeps
the separate per-request reasoning effort (intelligence). An update of either
during DOING applies to the task's Agent Session: the effort level to the
remaining budget, the reasoning effort to the next provider request; a request
already submitted retains the reasoning effort it used. A terminal task's
settings are metadata for any future authorized run and do not restart work.

## Pacing order and Worker phase

Concurrent claims do not raise provider throughput: every ordinary Worker
action still waits for the shared pacing gap (10 seconds on a healthy
account, widened by durable 429 pressure). Served first-come,
the gate spent every slot on new-task navigation before any claimed task
uploaded, so all Workers read as busy while none had submitted. Waiters are
therefore ordered, never spaced differently: an action of a task that already
performed a paced provider action takes the next slot, then first-come order
among equals. A fresh execution paces a composer navigation only when the page
is not already at its destination; the upload that follows is paced anyway.

Each Worker publishes the phase of its current task as a closed code:
`claimed`, `waiting_turn`, `navigating`, `preparing`, `uploading`,
`submitting`, `processing`, `downloading` or `validating`. The runtime drawer
shows that phase instead of inferring one from the task type. The phase
carries no page content and clears when the task settles.

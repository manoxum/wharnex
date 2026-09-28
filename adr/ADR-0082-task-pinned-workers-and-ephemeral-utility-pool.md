# ADR-0082 — Task-pinned execution Workers and an ephemeral utility pool

- Status: Accepted
- Supersedes: the persistent-Worker placement of `ORCHESTRATOR_PLAN` and
  `RELEASE_NOTES` in `adr/ADR-0078`; the idle-Worker translation borrowing in
  `adr/ADR-0079`; the planning and translation bands of the Worker queue in
  `adr/ADR-0080`.
- Related: `adr/ADR-0049`, `SoT/ARCHITECTURE.md`,
  `CHATGPT_AUTOMATION_MAINTENANCE.md`.

## Context

Every time an Orchestrator execution attempt landed on a different Worker, that
Worker opened the task's conversation again. Each opening costs several ChatGPT
reads: the page, the sidebar list and the conversation itself. ChatGPT
throttled these reads for the Wharnex browser, and the reopenings kept that
throttle alive.

Translation, Orchestrator planning and release notes also shared those Workers.
A plan waited for a free execution Worker, and an execution waited behind a
plan, although they are unrelated.

## Decision

### Execution Workers stay with their task

A persistent Worker that runs an `ORCHESTRATOR_EXECUTE` attempt stays pinned to
that task's lane (`h:<task id>`, stable across every attempt). While pinned:

- it claims only that lane, with the resident-only claim, even when the lane
  has nothing due yet;
- every other Worker excludes that lane from its claims;
- it is not free capacity for auto scale.

An attempt that ends DONE (the task left READY/DOING), FAILED or ATTENTION ends
the run and releases the pin. So does a lane that stays silent for 15 minutes,
for example when its queue entry was cancelled or used up its attempts in the
backend. A pin never survives the Worker slot that holds it. A Worker that
parks on `about:blank` after a conversation failed to load stays pinned, and
the next attempt reopens the same conversation. Auto scale never drains the
pool below its highest pinned Worker: draining one destroyed its conversation,
and the next claim grew the pool again and reopened ChatGPT from its home page
in a loop.
Like a Supervisor, the pinned Worker stays on the task's conversation between
rounds and navigates only when a round needs the page. From a blank page (a
new Worker, or one parked after a failed load) it goes straight to the task's
conversation, never to the home page first; only a task without a
conversation yet starts from the home page.
The runtime drawer shows a pinned Worker as held by its task ("Preso à
tarefa") between rounds, including after its bundle is delivered and while
the Agent runs the task locally, exactly as a Supervisor shows its chat
between observations. It becomes free only when the pin is released. A follow
window opened on a pinned Worker stays open across rounds and closes when
the pin is released, not when one round's claim settles.

The configured Worker count and auto scale apply to Orchestrator execution,
plus the account-lifecycle and classification work that is still on this pool.

### Translation, planning and release notes use ephemeral Workers

`TRANSLATE_MARKDOWN`, `ORCHESTRATOR_PLAN` and `RELEASE_NOTES` belong to the
ephemeral utility pool (backend role `translator`). The durable claim enforces
this partition before an attempt is charged. Persistent Workers never claim
these types, and the utility pool claims nothing else.

The utility scheduler keeps one claim loop per due task plus one per running
task. It never counts free execution Workers as capacity, and it ignores the
Worker count and Worker suspension. The canonical `translator-N` ids bound it
at 64 simultaneous loops; that is an identity limit, not a policy.

Each claimed task gets its own hidden hardened browser:

- a translation's browser is destroyed when that single request settles;
- a plan or release-notes browser lives until its task settles, so a WAITING
  observation of a response still being generated keeps the page on its
  conversation;
- a kept browser that is not claimed again for 20 minutes is destroyed.

Utility actions take the highest pacer priority (above an execution action
that already reached ChatGPT), but still honour the shared pacing gap. Provider
rate-limit and read-cooldown checks still apply at the action boundary, as
free, attempt-neutral waits.

## Consequences

- Fewer conversation openings per execution task: one Worker keeps its
  conversation for the whole task.
- A READY task waits for a Worker that is not pinned. Auto scale grows up to
  the policy maximum, because pinned Workers are never free.
- Planning and translation no longer depend on the execution backlog.

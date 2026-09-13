# ADR-0044 — Project-scoped browser-agent queue over a shared agent pool

## Status

Accepted for Wharnex v1.3.6. Extends `adr/ADR-0038` (pooled chat agents) and `adr/ADR-0019` (multi-window, multi-project workspaces).

## Context

Wharnex runs one durable browser-agent queue and one global pool of ChatGPT renderer slots for the whole authenticated Desktop process, while a single Desktop process may hold several windows, each bound to several projects. Three defects followed from that shape.

**A project saw other projects' work.** The **Tarefas** drawer listed the queue unfiltered and read its counters from an unfiltered aggregate. Opening two projects side by side showed each of them the other's chats, request ids and lineage. That is not a cosmetic leak: the operator reads that panel to decide whether *their* project is stuck, and a backlog belonging to a project they are not looking at answers a question they did not ask.

**A Worker could run work for a project nobody has open.** The claim ordered the whole queue by priority and age, so a project closed hours ago still competed for the pool against the projects on screen. Worse, the work it won cannot be supervised: the operator cannot see its chat, cannot read the response, cannot intervene when it needs attention. A request that is going to need a human is being progressed while no human can reach it.

**`project_id` was not a project.** The column existed but was populated inconsistently — the Orchestrator wrote the canonical host project path, the Desktop transport wrote the *ChatGPT project display name*, and the translation utility wrote nothing at all. A field with three meanings cannot filter anything, so no amount of UI work would have fixed the first two defects on its own.

The third is the reason the other two are addressed together rather than separately.

## Decision

### `project_id` is the canonical host project path

A browser-agent task's owning project is the absolute host project path — the same identity a workspace chat stores in `project_path` and a session in `project_path`. A ChatGPT project display name is a remote presentation label that the operator can rename from ChatGPT's own UI; it was never an identity Wharnex may key on.

Attribution is resolved by the store at enqueue, not by each caller:

1. a supplied absolute path is kept;
2. anything else is discarded rather than stored as a project;
3. the store then resolves the task's own `chat_id` to its workspace chat's `project_path`, and failing that its `session_id` to its session's `project_path`.

Resolving centrally is what makes the attribution trustworthy. A caller that forgets — or, as with the transport path, remembers the wrong value — cannot produce an unattributable task that then escapes every project filter.

An unresolvable task keeps an empty `project_id`. That is a real state, not a failure: a chat may be enqueued before its durable row exists. It is treated as belonging to no project, which means every project's panel hides it and no project scope blocks it.

### A project sees only its own tasks

The task list and the queue aggregate both accept a project filter, and the drawer always sends one. The aggregate is filtered by the same predicate as the list, because a panel whose cards and counters disagree is worse than either alone.

The drawer additionally reports, as a single number and nothing more, how many active tasks belong to other projects. The operator sharing one agent pool across projects needs to know that the pool is busy elsewhere; they do not need — and must not be shown — what that work is.

### Agents are shared; claims are scoped to open projects

The Supervisor/Worker pool stays global to the Desktop process. Multiplying it per project would multiply authenticated renderers against one account, which is what `ADR-0038` exists to avoid.

What is scoped is the claim. The Desktop passes its own project-window registry — the set of projects currently open in some window — as a claim option, and the durable claim admits a task only when:

- the caller did not scope by project (the web/dev path, and any caller that cannot know the window topology); **or**
- the task has no project attribution; **or**
- the task's project is currently open in some window; **or**
- the task is account-lifecycle work.

**Account-lifecycle work is deliberately exempt.** `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`, `DELETE_BUNDLE` and `DELETE_TEMP_CHAT` — the closed set the queue already treats as account-exclusive — act on the ChatGPT account, not on the project. The chat-deletion convergence rule in `AGENTS.md` requires that deleting a chat actually deletes its remote conversation, its temporary sibling and its library bundles; scoping that to an open project would leave an operator's account accumulating conversations and files they explicitly asked to be removed, with no surface anywhere that explains why. Account hygiene converges regardless of which projects happen to be on screen.

Everything else — `BOT_WRITE`, `RECOVERY_WRITE`, `AWAIT_RESPONSE`, the title tasks, `ORCHESTRATOR_PLAN`, `TRANSLATE_MARKDOWN` — is request-bound project work and waits for its project.

Scoping is applied at the claim, not after it. Claiming and immediately releasing would charge the task an attempt for a decision that had nothing to do with the task, which is the same defect the provider-cooldown skip exists to prevent.

Closing a project admits nothing new; it interrupts nothing already leased. This mirrors the per-project execution-concurrency rule: a limit lowered while work is in flight drains, it does not abort.

### A busy agent says whose work it is busy with

The agent runtime task projection carries `project_id`, and the agents panel — which is global by design, because the pool is — marks an agent whose current task belongs to a different project than the window's own, naming that project. Without it the panel truthfully reports "0 Workers available" while every card looks idle to the operator reading it from the project whose work is *not* running.

The panel exposes the other project's identity and nothing else about its task. That is the minimum needed to explain the occupancy and the maximum that a project boundary should let through.

## Consequences

- A task enqueued before its workspace chat row is durable has no project and is visible in no project panel. It still runs. The alternative — guessing a project — would put one project's work on another project's screen, which is the defect being removed.
- With every project closed, a Desktop still drains account-lifecycle work and nothing else. That is the intended resting state, and the queue aggregate's other-project counter is how the operator sees that anything remains.
- The claim gains a project predicate on a hot path. It is an equality test against a bounded list already carried in the same statement as the lane options, and the list is capped like `excluded_lanes`.
- Pre-existing rows carrying a ChatGPT project name in `project_id` are not migrated. They will not match any project filter, so they behave exactly like unattributed tasks: visible nowhere, claimable everywhere. They drain on their own within the queue's ordinary retention.

## Alternatives considered

**Filter in the frontend.** Cheap, and wrong on the claim side: the Worker would still be running work for a project nobody can see, and the operator would be told the pool is free when it is not.

**One queue per project.** It makes the scoping trivial and the account guarantees impossible: the account-exclusivity guard, the provider cooldown and the rate-limit gate are properties of one ChatGPT account and have to be enforced across every project at once.

**Scope by window rather than by project.** A project may be bound to several windows over its life and a window to several projects; work belongs to the project, not to whichever window happened to start it.

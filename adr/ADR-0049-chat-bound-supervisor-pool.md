# ADR-0049 — Chat-bound Supervisor pool and role-partitioned browser queue

- Status: Accepted
- Supersedes the pool topology in `adr/ADR-0038` (two Supervisor slots, six Workers) and the temporary
  visible-Supervisor observation handoff introduced there.
- Related: `adr/ADR-0037`, `adr/ADR-0044`, `adr/ADR-0047`, `SoT/ARCHITECTURE.md`, `SoT/AUTOMATION_BUNDLE.md`.

## Context

Wharnex kept earning HTTP 429 from ChatGPT even after every pacing, cooldown and backoff control this
repository already documents was in place. Two measurements narrowed the cause:

1. The rate limiting began when the Supervisor/Worker topology was introduced.
2. Stopping the Worker pool entirely did **not** stop it. Supervisors alone still produced 429s.

The remaining variable is the one the Supervisor pool cannot avoid under the old topology: **navigation**.
Two Supervisor slots served an arbitrary number of Harness chats, so selecting a third chat evicted a
resident conversation and loaded the new one, and selecting the first one back loaded it again. Every one
of those loads is a real authenticated request to `chatgpt.com`, made with no work attached to it — pure
churn produced by the operator alternating between conversations.

The Worker pool has the same shape for a different reason: residency is an affinity cache, so a Worker
rebinding to another lane navigates. Worker navigation is at least paid for by a task; Supervisor
navigation was paid for by nothing at all.

Wharnex had the opposite behaviour before this topology existed: one browser instance per chat. It was
heavy — fifteen open chats meant fifteen renderers — but it never re-navigated, because no chat ever lost
its renderer to another chat.

## Decision

Return to one renderer per chat, bounded and with an explicit release rule.

### 1. Pool topology

- **Six Supervisor slots** (was two). Six is the number of conversations an operator realistically
  alternates between; beyond that the cap applies and the least recently used *released* slot yields.
- **Three Worker slots** (was six, hard maximum six). Small account and utility work does not need more,
  and every Worker is a potential navigation.

### 2. A Supervisor is bound to one chat for the life of its request

A Supervisor may release its chat only when **both** conditions hold:

1. It holds nothing unfinished — no armed expected bundle, no settling bundle delivery, no queued comment,
   no open transport or account operation, no pending human action, no in-flight external login, no live
   Supervisor lease, no prepared or retryable prompt; **and**
2. another chat is actually waiting for a slot.

The second condition is as load-bearing as the first. Releasing a settled chat on a timer would reload
that conversation the next time the operator opened it, which is the churn this decision removes. There is
therefore no idle reaper: eviction happens only on demand, at the moment a new chat needs a slot.

When every slot is held, the new chat waits. A Supervisor task that finds no slot returns a free
observation — nothing reached ChatGPT, so it charges no attempt.

### 3. Supervision no longer depends on visibility

`ADR-0038` gave the *visible* Supervisor a temporary handoff for passive observation, and required hidden
slots to stand down so background supervision stayed the Worker's job. That rule existed because a hidden
slot was a warm standby for the next chat, not the owner of a request.

The relationship is now inverted. The Supervisor that submitted a request stays on that conversation until
its bundle arrives, so the main-process bundle poll runs for **every** bound Supervisor on the bounded DOM
polling cadence, visible or not. Reading an already-loaded page costs no provider request; a Worker doing
the same work would first have to navigate to it.

Two cases are excluded from ownership because no automated supervision may run on those surfaces at all:
Manual transport mode, and an in-flight external-browser login. Claiming the lane there would silence it
for every pool.

### 4. The durable queue is partitioned by pool role

The claim takes a `role` (`supervisor` | `worker` | empty):

- **Supervisor types**: `AWAIT_RESPONSE`, `BOT_WRITE`, `RECOVERY_WRITE`, `ORCHESTRATOR_PLAN` — opening the
  chat, submitting the request bundle, following the remote instance, collecting the response bundle. This
  covers chats created by both the Agent and the Orchestrator.
- **Worker types**: everything else — `ORGANIZE_CHAT`, `RENAME_CHAT`, `ARCHIVE_CHAT`, `DELETE_CHAT`,
  `DELETE_TEMP_CHAT`, `DELETE_BUNDLE`, `TITLE_DISCOVER`, `TITLE_GENERATE_TEMP`, `TITLE_AWAIT`,
  `TRANSLATE_MARKDOWN`.
- **Empty role** stays unrestricted, for callers that run no role-partitioned pool.

The partition is enforced by the durable claim, in both the SQL query and the in-memory fallback, for the
same reason project scoping is (`adr/ADR-0044`): a claim charges an attempt, so claiming work the wrong
pool cannot run and handing it straight back would spend that task's own bounded retry budget on a routing
decision that had nothing to do with the task.

An explicit operator pin overrides the partition. The pin already names one canonical agent; refusing it
by role as well would leave the task reachable by nobody — pinned away from its own pool and barred from
the other. Agent ids are therefore canonical in two namespaces, `worker-N` and `supervisor-N`.

Enqueue is also a local wake signal for both role-partitioned claim loops. Their idle delay remains a
bounded fallback for backend/external arrivals, but a task created by this Desktop is claimable
immediately; its availability is not hidden behind the next polling tick.

### 5. What each pool may not do

A Supervisor never renames, organizes, archives or deletes a chat, never deletes a library bundle, never
discovers or generates a title, and never translates. Those are exactly the jobs that would otherwise take
a slot away from a live request, and each of them is small enough that a Worker's navigation is
proportionate.

A Worker never takes chat-bound work, and is additionally excluded from the lanes bound Supervisors hold,
as defence in depth: a Worker arriving on a conversation a Supervisor is resident on is a second
navigation of a loaded page even when the task itself is legitimate.

`TRANSLATE_MARKDOWN` keeps the Supervisor's *shape* on the Worker side — the Worker stays with the task
until its translation artifact is delivered — but it releases the conversation as soon as that artifact
downloads, because a translation conversation is temporary and is deleted afterwards anyway.

### 6. Bounding a passive supervision

A `AWAIT_RESPONSE` lease that only watches an already-resident page attempts nothing, so it must not spend
the attempt budget — and therefore needs bounds that are not a counter. Two apply:

- **Structural silence.** The main-process poll stamps progress on every generating, completion or
  download signal. When no such signal appears for `AWAIT_STALL_ATTENTION_MS`, the supervision moves to
  `ATTENTION`. A visibly working model never trips this; a genuinely dead surface does.
- **Task age.** A supervision older than the expected-bundle TTL moves to `ATTENTION`. This bound survives
  a Desktop restart, which the in-memory expectation does not.

## Consequences

- Alternating between up to six chats performs **no** provider navigation at all. That is the 429 source
  this ADR removes.
- Memory cost rises: up to six Supervisor renderers plus three Workers, against two plus six before. The
  slot count is the explicit control the earlier one-renderer-per-chat design lacked.
- A seventh chat with all six slots held waits rather than interrupting a live request. This is deliberate:
  the alternative is exactly the eviction that caused the problem.
- `assignRoles` no longer backfills the Supervisor cap from undeclared slots. With six Supervisor slots
  that backfill would report five Supervisors and no Worker for an ordinary pool; a slot is now a
  Supervisor because it was declared or named one, with a single-slot fallback so a human surface always
  exists.
- Desktop runs two scheduler clients against one durable queue. Lease ownership already distinguishes them
  (each client has its own instance id), and the pool role plus the agent-id namespace distinguish them in
  the claim.

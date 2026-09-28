# ADR-0081 — An Orchestrator task is one agentic Main Request

- Status: Accepted (2026-09-28); implementation starts once the current task
  queue drains, so no execution in flight is interrupted.
- Supersedes (on acceptance): the execution transport of `adr/ADR-0078`
  (`ORCHESTRATOR_EXECUTE` Worker executor). Planning (`ORCHESTRATOR_PLAN`) is
  unchanged.
- Related: `adr/ADR-0049`, `adr/ADR-0080`, the remote prompt dispatch.

## Context

An Orchestrator task already runs on the agentic backend engine: it owns an
Agent Session, `SubmitMessage` builds its request with the Main Request
protocol, and `SubmitExecutionBundle` ingests the response through Policy,
Protected sandbox, verification, Auto, repair rounds and Apply.

Its transport does not. An agentic Main Request is written by `BOT_WRITE`
(`PREPARE_PROMPT`), supervised by `AWAIT_RESPONSE`, and its bundle is
delivered to the renderer, which ingests it and drives the next round. An
Orchestrator task instead uses a dedicated Worker executor
(`chat-agent-orchestrator-execution.mjs`) with its own response window, its
own schema-repair prompt, its own continuation loop and none of the
supervision rules (adaptive eligibility, delivery continuation, stall and
settle bounds, processing-duration learning, verified effort). Every fix to
one path has to be ported to the other, and the task views cannot reuse the
agentic Files, Plans, Execution and Resume surfaces because the task leaves
none of the chat records they read.

A chat can hold many Main Requests; a task is exactly one.

## Decision

1. **One chat per task.** Starting a task registers a workspace chat for it
   (identity derived from the task id, grouped under Orchestrator and hidden
   from the ordinary chat list) bound to the task's Agent Session. The
   task's ChatGPT conversation link is durable on the task and reused by
   every attempt, repair and retry.
2. **Same write and supervision.** The backend enqueues the task's Main
   Request as `BOT_WRITE`/`PREPARE_PROMPT` exactly like the remote dispatch,
   followed by the ordinary `AWAIT_RESPONSE`. The task message keeps its
   coordination context (`SoT/AI_PROTOCOL.md`).
3. **Workers serve task chats.** The claim partition gives `BOT_WRITE` and
   `AWAIT_RESPONSE` of a chat marked as an Orchestrator task to the Worker
   pool, in the global FIFO of `adr/ADR-0080`. Human chats keep Supervisors.
   A Worker executes them with the same Desktop functions a Supervisor uses;
   the global Worker pacing still applies. The Worker that takes a task's
   first round stays pinned to that task's lane until the task settles
   (`adr/ADR-0082`), so it plays the Supervisor's role for that one Main
   Request: one Worker, one conversation, every round.
4. **Same delivery, one round driver.** The captured bundle goes through the
   ordinary bundle delivery. The decision of the next round (ingestion,
   workflow evidence, automatic continuation, repair, delivery continuation)
   is taken by one headless round driver that the agentic chat and the task
   both use, not by the renderer. A task has no window to drive it, and a
   renderer-only driver is what made the task path a separate copy. The task
   leaves DOING from the Agent outcome: applied or a report goes to REVIEW; a
   failure, block, or stop that waits for a person fails the run
   (`adr/ADR-0078`).
5. **Views read chat records.** Task detail tabs (Files, Plans, Execution,
   Resume, Engine) read the task chat's records through the same components
   the agentic chat uses.
6. `ORCHESTRATOR_EXECUTE`, its executor and its schema-repair loop are
   removed once no durable attempt uses them; in-flight attempts finish on
   the old path.

## Consequences

- One transport to maintain; a fix to the agentic path fixes tasks.
- The effort level bounds a task exactly as it bounds a Main Request.
- Requires an open project window, as every claim already does
  (`adr/ADR-0044`).
- Resolved: only Workers serve task chats (Supervisors stay with people);
  tasks already in DOING finish on the old path. Still open: how hidden task
  chats appear in chat search and export.
- Evidence behind the decision, from one day of live runs: each fix had to
  be ported twice (delivery continuations, schema repair, submit
  confirmation, conversation reuse), and the terminal report outcome
  (`investigated`) existed only for chats, holding a barrier task in DOING
  for five hours.

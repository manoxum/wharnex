# ADR-0081 — An Orchestrator task is one agentic Main Request

- Status: Proposed
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
   the global Worker pacing still applies.
4. **Same delivery.** The captured bundle goes through the ordinary bundle
   delivery to the renderer, which routes it to the task chat and runs the
   same ingestion, automatic continuation and repair logic as any chat. The
   task leaves DOING from the Agent outcome as today.
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
- Open points before acceptance: how hidden task chats appear in chat
  search and export; whether Supervisors may also serve task chats when
  Workers are suspended; migration of tasks already in DOING.

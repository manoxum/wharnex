# ADR-0007: Agent turn outcomes before execution plans

**Status:** Accepted, amended by ADR-0015

## Context

The original planner contract forced every user message into `harness.execution/v1`. Questions and diagnostic requests therefore became empty plans, could run verification, and could be marked applied without returning the useful answer to the Harness transcript.

Consumer ChatGPT automation also cannot safely detect completion or click generated output because Wharness does not inspect the remote DOM or response content.

## Decision

Provider output first normalizes to `harness.turn/v1`: `answer`, `clarification`, `investigation`, `workflow`, `change`, or `blocked`. `workflow` and `change` may carry execution plans, but with different semantics: workflow is a bounded non-terminal Protected-sandbox evidence probe and can never Apply to host; only `change` is a project mutation. Answer, clarification, investigation, and blocked outcomes are terminal conversational results and never reach the executor.

Supported provider adapters return the structured turn directly. The embedded ChatGPT consumer surface transports the same result in a user-initiated `wharness-bundle-<request_id>.zip`; Wharness intercepts and imports the download after it starts but does not inspect or click remote output.

Legacy bundles containing only `plan.json` remain compatible and normalize to a change turn.

## Consequences

- Questions and analysis are visible as full responses in the Harness transcript.
- Auto cannot execute terminal conversational turns. It may run bounded command-only `workflow` probes without host Apply, as defined by ADR-0015.
- Truly unattended operation requires a supported provider adapter.
- Execution protocol and Policy validation remain unchanged for project mutations.

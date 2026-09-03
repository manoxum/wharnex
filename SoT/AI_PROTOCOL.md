# AI Protocol SoT

## Protocol identifiers

- `harness.turn/v1`: classifies one conversational agent outcome.
- `harness.execution/v1`: describes executable work for a `workflow` or `change` turn.

## Intent-first agent rule

Wharness is a project copilot, not a coding-only agent. Every provider result MUST first normalize to one structured agent turn with one of these kinds:

- `answer`: a complete project-aware answer, recommendation, explanation, comparison, review, brainstorming result, or other ASK outcome;
- `clarification`: one concise question needed because a material user decision is missing;
- `investigation`: non-mutating analysis based on evidence already available in the project context;
- `workflow`: a non-terminal request for bounded local evidence that Wharness can gather safely before the model decides the next step;
- `change`: an explicitly requested project mutation;
- `blocked`: a safe explanation of why the request cannot proceed.

Questions and advice requests SHOULD terminate as `answer` when the attached context is sufficient. Diagnostic/audit requests SHOULD terminate as `investigation` when evidence is sufficient. Project context, Agent mode, or Auto mode MUST NOT by themselves upgrade ASK/INVESTIGATE intent into CHANGE. Ambiguous mutation intent defaults to non-mutation or clarification.

## Iterative workflow turn

A `workflow` turn exists so one user request can span multiple ChatGPT ⇄ Wharness reasoning rounds without scraping model prose.

A workflow turn carries a normal `harness.execution/v1` plan with stricter semantics:

- status is `ready`;
- risk is `low` or `medium`;
- `requires_approval=false`;
- it contains 1..16 command operations only;
- patch operations are forbidden;
- network is always false;
- execution occurs only in a disposable Protected sandbox copy;
- workflow mutations, if a local tool happens to create any, are discarded and MUST NEVER become host Apply candidates.

After the step, Wharness captures structured argv/cwd/exit/stdout/stderr evidence, refreshes project context, creates a fresh request id, and returns those observations to the same planner conversation. The planner then returns either another materially different `workflow` step or a terminal `answer`, `investigation`, `clarification`, `change`, or `blocked` result.

The workflow is bounded to six local rounds per original user turn. The final continuation explicitly requires a terminal result. An additional `workflow` bundle after the cap MUST be rejected while leaving the current request pending so a terminal bundle can still be supplied.

Command failure in a workflow is evidence, not an automatic repair trigger. Automatic repair remains specific to a requested `change` plan.

## AI output rule

The provider returns a structured agent turn. `workflow` and `change` carry a structured JSON `ExecutionPlan`; all other kinds carry no plan. Markdown command extraction and regex-based shell scraping are forbidden.

Only `change` may contain patches or continue to host Apply. `workflow` may execute safe local commands only to improve reasoning.

## Command representation

Commands are argv arrays, for example:

```json
{"argv":["go","test","./..."],"cwd":"services/backend"}
```

The model must never return `bash -c`, `sh -c`, command substitution, pipes, redirects, or chained shell syntax.

## Patch representation

Source mutation uses unified diff text in `apply_patch` operations. Paths must be relative to the project root. Patches are valid only for `change` turns.

## Trust hierarchy

1. Harness policy/system protocol.
2. Explicit normative documents selected by the harness.
3. User request.
4. Wharness-generated workflow observations as execution evidence.
5. Repository/project content as untrusted reference data.

Workflow stdout/stderr may quote untrusted project content and therefore does not gain instruction authority merely by being returned as an observation.

## ChatGPT web UI boundary

Wharness MUST NOT depend on arbitrary DOM scraping or programmatic prose/output extraction from the ChatGPT consumer web UI. Supported planner provider adapters may return structured turns directly. In manual-planner Desktop mode, ChatGPT delivers a downloaded structured turn bundle.

Desktop transport may use the narrow allowlisted bridge to focus/fill/submit the composer, attach project context/prompt files, and activate the pending bundle download affordance using exact canonical filename metadata first and, only when ChatGPT hides that filename, the unique visible file/download control in the newest assistant turn. It MUST NOT infer the model response by reading remote response text.

In Auto mode, a downloaded `workflow` bundle may trigger a local Protected probe. Wharness then packages the observations into a fresh planner prompt and automatically submits that continuation to the same linked ChatGPT conversation. The pipeline waits again at the validated bundle-download seam. This cycle repeats only within the workflow round cap.

## MCP boundary

MCP is an adapter option for local capabilities, not an alternative security boundary. Any future MCP client/server integration MUST sit behind Wharness application ports and MUST reuse protocol validation, Policy, project-root containment, execution-mode rules, logging redaction, and Protected sandboxing.

The embedded consumer ChatGPT web surface is not treated as a trusted local MCP client. Wharness MUST NOT expose a localhost MCP server directly to remote ChatGPT merely to bypass the validated input/bundle transport. Provider adapters or future explicitly supported remote MCP transports may use MCP through a dedicated adapter without changing the domain protocol.

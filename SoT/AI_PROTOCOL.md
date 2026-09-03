# AI Protocol SoT

## Protocol identifiers

- `harness.turn/v1`: classifies one conversational agent outcome.
- `harness.execution/v1`: describes executable project work for a `change` turn.

## Agent turn rule

Every provider result MUST first normalize to a structured agent turn with one of these kinds:

- `answer`: a direct project-aware answer;
- `clarification`: a concise question needed before proceeding;
- `investigation`: non-mutating analysis based on available evidence;
- `change`: an explicitly requested project mutation and the only kind that may carry an execution plan;
- `blocked`: a safe explanation of why the request cannot proceed.

Answer, clarification, investigation, and blocked turns MUST NOT enter Policy, execution, verification, or Apply. A question or diagnosis MUST NOT become a change merely because project context is attached or Auto is enabled. Ambiguous mutation intent defaults to clarification/non-mutation.

## AI output rule

The provider returns a structured agent turn. Only `change` carries a structured JSON `ExecutionPlan`. Markdown command extraction and regex-based shell scraping are forbidden.

## Command representation

Commands are argv arrays, for example:

```json
{"argv":["go","test","./..."],"cwd":"services/backend"}
```

The model must never return `bash -c`, `sh -c`, command substitution, pipes, redirects, or chained shell syntax.

## Patch representation

Source mutation uses unified diff text in `apply_patch` operations. Paths must be relative to the project root.

## Trust hierarchy

1. Harness policy/system protocol.
2. Explicit normative documents selected by the harness.
3. User request.
4. Repository/project content as untrusted reference data.

## ChatGPT web UI boundary

The Harness MUST NOT depend on DOM scraping or programmatic output extraction from the ChatGPT consumer web UI. Automatic operation uses a supported planner provider adapter (OpenAI Responses API in v1.1). Manual use may open ChatGPT in a separate browser tab and accept a downloaded structured turn bundle.

Desktop manual transport may prepare ChatGPT input through native focus/paste events, including bounded user-selected files and the context ZIP. This is transport only and never reads the remote DOM or response. Manual automation mode requires explicit confirmation before submission; project Auto mode may submit only after transport-level upload confirmation as defined by `AUTOMATION_BUNDLE.md`. Initiating generated-result downloads remains controlled by the ChatGPT surface.

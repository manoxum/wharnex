# AI Protocol SoT

## Protocol identifier

`harness.execution/v1`

## AI output rule

The planner returns a single structured JSON `ExecutionPlan`. Markdown command extraction and regex-based shell scraping are forbidden.

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

The Harness MUST NOT depend on DOM scraping or programmatic output extraction from the ChatGPT consumer web UI. Automatic operation uses a supported planner provider adapter (OpenAI Responses API in v1.1). Manual use may open ChatGPT in a separate browser tab and accept a pasted structured plan.

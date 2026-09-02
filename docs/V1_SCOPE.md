# V1 Scope

## Implemented

- React/TypeScript two-pane engineering workspace.
- Local project session bootstrap.
- Secret-filtered context scan.
- Local ZIP snapshot + manifest + text planner context.
- OpenAI Responses API adapter with Structured Outputs.
- Manual Chat Bridge for copy/paste workflows.
- Versioned `harness.execution/v1` protocol.
- Semantic protocol validation and request-ID freshness check.
- Command/patch policy engine.
- Docker runner with isolated copied workspace and network disabled by default.
- Development-only local runner behind explicit opt-in.
- Patch verification in sandbox before host mutation.
- Separate explicit host Apply operation.
- SSE event stream, execution logs, plan/policy UI.
- Go unit/integration/race tests and frontend unit/E2E test scaffolding.
- Normative AGENTS/SoT/ADR/security/quality-gate documentation.

## Deliberately not implemented in V1

- Automated scraping of the ChatGPT web UI.
- Automatic DOM extraction from a ChatGPT iframe.
- Autonomous arbitrary shell access.
- Persistent multi-user database/authentication.
- Dedicated rootless Docker daemon provisioning.
- Incremental/delta context refresh after every host change.
- Typed tool-calling loop (`read_file`, `search_code`, etc.); V1 uses one structured plan per request.

These are future-version concerns, except ChatGPT web scraping, which is intentionally outside the core design.

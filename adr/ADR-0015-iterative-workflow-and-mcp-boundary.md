# ADR-0015 — Iterative workflow and MCP boundary

## Status

Accepted for v1.2.19.

## Context

Wharness originally optimized the Agent path around a single planner response that either answered or produced a code-change plan. This made project-aware ASK/advice requests feel coding-biased and left diagnostic requests with an awkward choice: guess from the context ZIP or prematurely produce a change.

The Desktop already has a safe consumer-ChatGPT transport boundary: Wharness can submit prepared files/prompts and import the exact pending result bundle, but it deliberately does not scrape generated prose. A multi-round workflow therefore needs to reuse that boundary rather than add response scraping.

MCP is a useful standard for connecting model applications to tools/resources, but it must not become a side channel around Wharness Policy or Protected execution.

## Decision

1. `harness.turn/v1` adds `workflow` as a distinct non-terminal kind.
2. ASK/advice is explicitly first-class and defaults to a complete `answer` when current context is sufficient. Only explicit mutation intent becomes `change`.
3. A workflow turn carries `harness.execution/v1`, constrained to command-only, network-disabled, low/medium-risk, no-approval work.
4. Workflow commands execute only in a disposable Protected sandbox. Their outputs are evidence and are never applied to the host.
5. Wharness refreshes context after the probe and sends structured observations back under a fresh request id to the same planner conversation.
6. The loop is capped at six workflow rounds. The last continuation requires a terminal result.
7. In the consumer ChatGPT path, each round still crosses the validated bundle-download boundary; no arbitrary response scraping is introduced.
8. Automatic change repair and workflow iteration are separate loops. A failed workflow command is returned as evidence instead of entering repair.
9. MCP is reserved as a local/provider adapter layer behind application ports. An MCP adapter must reuse Wharness Policy, containment, sandboxing and redaction. The embedded ChatGPT web page is not considered a trusted localhost MCP client.
10. The official Go MCP SDK is the preferred implementation candidate when an actual MCP adapter is added; v1.2.19 does not add that dependency merely to reproduce capabilities already supplied by the Wharness runner.

## Consequences

- One user request can now alternate between reasoning and targeted local evidence without becoming a coding task.
- The same mechanism can later expose richer read-only/project-local tools without changing the turn protocol.
- Consumer-web workflows remain bounded by download initiation on the ChatGPT surface; provider adapters are the path to fully unattended multi-round planning.
- MCP integration can be introduced incrementally without granting remote content direct host capabilities.
## v1.2.27 amendment — Plan-first is a user gate, not a workflow probe

Plan-first is distinct from iterative workflow. It asks the planner for a terminal proposal with TODO, affected areas, risks and verification, but deliberately carries no execution plan or patch. The backend persists the planning mode and rejects any executable bundle for that request. Only an explicit user approval in Wharness creates a fresh direct implementation request. This prevents Auto mode from silently upgrading a planning request into mutation.

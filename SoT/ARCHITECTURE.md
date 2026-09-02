# Architecture SoT

## Macro architecture

Wharness uses ports-and-adapters / Clean Architecture boundaries:

`transport -> application -> domain <- ports <- adapters`

Planner adapters and sandbox adapters are replaceable. AI providers cannot depend on Docker execution details. Executor logic cannot depend on OpenAI response formats beyond the normalized domain plan.

## Core workflow

`Session -> Context -> Plan -> Policy -> Sandbox Execute -> Verify -> Explicit Host Apply`

There is no direct `AI -> shell` path.

## Services

- `services/frontend`: React user experience.
- `services/backend`: Go API/orchestrator.
- `docker/runner`: execution environment.

# Agent and Planner Protocols

The canonical agent-turn contract is `schemas/agent-turn.schema.json`. Only a `change` turn may include the execution contract in `schemas/execution-plan.schema.json`. Normative behavior is defined in `SoT/AI_PROTOCOL.md`.

When remote consumer-Web transport is enabled, Wharness publishes one input
archive with `transport.json` following
`schemas/remote-input-manifest.schema.json`. The archive also contains the full
planner prompt under `prompt/`, optional current context under `context/`, and
explicit user/system files under `attachments/` and `artifacts/`. This transport
manifest is not an execution plan. The model still returns the canonical
execution bundle defined by the existing turn and plan schemas.

The application-level provider pool is configured by
`schemas/remote-storage-config.schema.json`. Priorities and quotas are evaluated
per named provider instance before the transport artifact is published; they do
not alter `transport.json` or any executable result semantics.

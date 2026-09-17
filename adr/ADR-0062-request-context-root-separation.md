# ADR-0062 — Separate request context roots

## Status

Accepted.

## Context

Combined workspace snapshots historically placed related `@ref` projects and external `@attach` material below legacy `RELATED_PROJECTS/` and `ATTACHMENTS/` namespaces. Expanding that snapshot wholesale below the outbound request `context/` root made the primary project boundary ambiguous and mixed patchable and read-only material in one tree. Direct uploads and artifacts already use separate top-level roots.

## Decision

Outbound planner request archives use four explicit context surfaces:

- `context/` contains only the primary project snapshot.
- `ref-context/<slot-name>/` contains related project snapshots.
- `att-context/attach-<slot>/` contains read-only external `@attach` material.
- `metadata/context-sources.json` uses `harness.context-sources/v1` to retain source identity, remapped prefixes and execution authority.

Direct user uploads remain under `attachments/`; system/user artifacts remain under `artifacts/`. Neither is project context. The Engine may retain the legacy combined-workspace representation internally for persisted-data compatibility, but Desktop and remote ZIP transports remap it at the outbound archive boundary. Persisted prompts that still mention the legacy namespace receive a bounded transport compatibility note describing the physical request roots.

## Consequences

Planner inputs have an unambiguous primary patch root, references and attachments cannot be mistaken for ordinary primary files, and older persisted combined snapshots remain readable without migration. Any new request transport must expose the same roots and context-source index.

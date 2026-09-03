# ADR-0011 — Context transparency and dependable Host-terminal submit

## Status
Accepted

## Context
Per-project context pruning made snapshots smaller, but users could not easily verify which root areas, exact files and exclusion rules produced the final ZIP. The Host terminal also relied on an input key handler with no explicit run affordance, making successful submission and failure states unclear.

## Decision
1. Extend the context manifest with structured exclusion details while retaining legacy exclusion strings.
2. Add a read-only context-inspection API generated from the authoritative current manifest and effective project rules.
3. Present three inspection views in `Contexto do Wharness`: final inventory, root structure and effective rules. The final inventory uses `manifest.files` as the exact inclusion source.
4. Keep large inventories searchable/filterable and render them incrementally.
5. Make terminal input a semantic form and add an explicit run button. Host execution remains argv-only and continues through the interactive Policy Engine and `HostRunner`.

## Consequences
Context decisions become auditable without opening the ZIP manually. The additional manifest field is backward-compatible because old sessions may omit it and inspection can fall back to legacy exclusion strings. Host-terminal UX becomes deterministic without weakening its security model.

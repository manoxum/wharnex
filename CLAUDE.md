# Claude entry point

This file is only a navigation guide for Claude and other compatible coding agents. It is not a Source of Truth and MUST NOT contain, duplicate, reinterpret, or replace project rules.

Before analyzing or changing Wharnex (WHX):

1. Read the repository-root `AGENTS.md` completely. It defines the authoritative document order, mandatory invariants, change protocol, and quality gates.
2. Read the root `README.md` to understand the product, repository workflow, lifecycle commands, compatibility identifiers, and current capabilities.
3. Identify and read every applicable document under `SoT/` completely before modifying the area it governs. Start with `SoT/PROJECT_STRUCTURE.md` and `SoT/ARCHITECTURE.md` when repository or architectural context is needed.
4. Read the applicable decisions under `adr/`, plus `SECURITY.md` and any component-level `README.md` relevant to the work.
5. Search for any more specific `AGENTS.md`, README, schema, test, or dedicated normative document in the affected subtree and follow it within its scope.

When documentation and implementation disagree, resolve the conflict according to the authority order defined in `AGENTS.md`. Do not treat this file as authority.

## Normative-document policy

- Never introduce a project rule, security invariant, architecture decision, protocol contract, UI standard, testing requirement, or execution policy in `CLAUDE.md`.
- Put every new or amended rule in its existing dedicated authoritative document: `AGENTS.md`, the appropriate `SoT/*.md`, `SECURITY.md`, an ADR, schema, or another purpose-specific document.
- Update the relevant authoritative documents in the same change whenever behavior alters their contract.
- Do not copy those rules back into `CLAUDE.md`. Keep this file short, stable, and limited to discovery/routing instructions.
- If no suitable authoritative document exists, create or propose a purpose-specific document in the established structure instead of expanding this file into a second policy source.

The intended workflow is therefore: discover authority here, understand the project through the README and applicable documents, implement against those sources, run their required gates, and leave normative knowledge in its dedicated owner.

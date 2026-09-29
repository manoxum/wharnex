# ADR-0085 — Domain-owned source layout

- Status: accepted
- Evidence: operator directive, 2026-09-29

## Context

The 200-line cap and extract-on-touch rule in ADR-0066 made files smaller but
did not say where extracted code belongs. Desktop helpers accumulated as flat
siblings of its Electron entry point, while `main.mjs` still mixes window
lifecycle, browser transport, Workers, and IPC. A smaller file with no clear
owner does not make those concerns easier to find or change.

## Decision

New and extracted project-owned implementation and test files live under a
named domain directory within their service. Tests stay near the concern they
verify. An entry point may remain where its runtime or tooling requires it;
implementation moves behind a domain module. Generic catch-all directories
do not establish ownership. `SoT/PROJECT_STRUCTURE.md` defines service-specific
locations and exceptions, and `SoT/CODE_QUALITY.md` binds extract-on-touch to
the same rule.

The Desktop refactor begins with independent window recovery, layout, and
restart-intent state under `services/desktop/window/`, plus the ChatGPT cache
marker under `services/desktop/chatgpt/`. These modules accept the small runtime
inputs they need. `main.mjs` composes them after Electron initializes; it does
not move browser authority into a standalone testable module.

Existing flat files migrate by concern when touched. A mass rename of every
service file is not required by this decision. Persisted filenames and wire
identifiers retain their shipped spelling when compatibility requires it.
`make domain-layout-check` rejects new implementation files without a domain
owner in the normal quality gate. Review remains responsible for whether that
named domain is the correct owner.
The check starts from the parent of the commit that adds this ADR, so legacy
flat files introduced before this decision are not retroactively failed. While
that commit has not yet been made, the pre-adoption commit `33f1c354` is the
bootstrap base. `WHARNEX_DOMAIN_LAYOUT_BASE` can override it explicitly.

## Consequences

- New Desktop tests in domain directories are included by the Desktop test
  command; a moved assertion continues to check the same behavior at its new
  seam.
- Future extractions identify the owner before creating a file. If ownership
  is unclear, clarify the module interface instead of adding a root-level
  helper.
- The 200-line limit remains in force for each new domain file; directory
  placement does not waive it.

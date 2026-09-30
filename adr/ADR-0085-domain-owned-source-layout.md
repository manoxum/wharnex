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

Desktop's flat modules are relocated into owned domains. Large domains are
further divided into named subdomains, so a directory cannot become a new
dumping ground. A directory containing more than 20 project-owned source and
test files MUST split by responsibility, recursively; new work cannot enlarge
an existing overfull directory. Window lifecycle, ChatGPT account/session/DOM/
transport and Agent scheduling/orchestration/supervision have distinct homes.
`main.mjs` composes the extracted modules after Electron initializes.

Multi-file domains compose recursively through narrow named entry points.
Service entry points import domain contracts, domain entry points compose
subdomain contracts, and leaves stay inside their owner. CSS uses ordered
aggregators so structural splits preserve the cascade and build output. Go
uses package APIs rather than synthetic barrel files. This rule reduces the
flat import lists that otherwise recreate the same coupling in an entry point.

Existing flat files migrate by concern when touched; this change also
reorganizes the currently selected frontend, backend and webapp concerns.
Persisted filenames and wire identifiers retain their shipped spelling when
compatibility requires it.
`make domain-layout-check` rejects new implementation files without a domain
owner and new files that push a directory beyond 20 source/test files in the
normal quality gate. Review remains responsible for whether each named
domain and subdomain is the correct owner.
The check starts from the parent of the commit that adds this ADR, so legacy
flat files introduced before this decision are not retroactively failed. While
that commit has not yet been made, the pre-adoption commit `33f1c354` is the
bootstrap base. `WHARNEX_DOMAIN_LAYOUT_BASE` can override it explicitly.

## Consequences

- New Desktop tests in domain directories are included by the Desktop test
  command; a moved assertion continues to check the same behavior at its new
  seam.
- Future extractions identify the domain and, when needed, subdomain before
  creating a file. If ownership is unclear, clarify the module interface.
- The 200-line limit remains in force for each new domain file; directory
  placement does not waive it.

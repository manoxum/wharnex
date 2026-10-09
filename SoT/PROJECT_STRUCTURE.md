# Project Structure SoT

Production code stays under domain-aligned service roots:

- `/services/frontend` — React Desktop/local workspace UI.
- `/services/webapp` — independent React + Tailwind paired remote-management UI.
- `/services/backend` — Go orchestration/API core.
- `/services/desktop` — Electron native composition shell and narrow desktop bridge.

Cross-cutting schemas live in `/schemas`; normative documents live in `/SoT`; container execution assets live in `/docker`; repository automation lives in `/scripts`.

## Domain ownership for implementation

Every new or extracted project-owned source or test file MUST have a domain
directory beneath its service's source root. A domain is the product capability
that changes the file (for example `window`, `chatgpt`, `agent`, `editor`,
`orchestrator`, `project`), not its language, framework, or generic role. Keep
the domain's implementation and focused tests together. Any directory with
more than 20 project-owned implementation and test files MUST be divided into
named subdomains, each owning a coherent capability. Count production and test
files together, across implementation extensions; configuration, documentation,
fixtures and generated files do not count. Apply the same limit recursively:
a subdomain that grows past 20 files also splits by responsibility. Existing
overfull directories are migration debt; no new file may enlarge one, and a
change touching an overfull concern MUST move that concern and its tests into
the appropriate subdomain. Do not create a directory solely to satisfy the
count while placing unrelated files inside it.

- Desktop native code: `/services/desktop/<domain>/<subdomain>/` when the
  domain exceeds the 20-file limit. `main.mjs` remains the Electron composition
  entry point; ChatGPT account, transport, DOM and session code lives under
  distinct `chatgpt/` subdomains; Agent scheduling, orchestration, automation
  and supervision live under distinct `agent/` subdomains. Small cohesive
  domains MAY keep files directly under `/services/desktop/<domain>/`. New
  root-level Desktop helper files are forbidden.
- Backend Go code: `/services/backend/internal/<domain>/`; executable entry
  points stay under `/services/backend/cmd/<command>/`.
- Desktop and paired web UIs: `/services/frontend/src/<domain>/` and
  `/services/webapp/src/<domain>/`, with each feature's components, hooks,
  state, and tests in its own domain. A technical directory such as
  `components/` MAY remain as an existing container but MUST contain a named
  feature directory before new feature files are added.
- Repository tooling: `/scripts/<domain>/` for new implementation scripts;
  established command entry points may stay at `/scripts/` and delegate to
  domain-owned modules.

Service entry points, package/build configuration, runtime-required preload
files, generated or vendored output, schemas, migrations, and normative
documents keep the locations required by their consumers. Existing flat source
files are migration debt, not an invitation to add siblings: when a concern is
touched, extract or move that concern and its focused tests into its domain in
the same change. Relocation MUST preserve wire, persisted-data, and runtime
compatibility, and tests MUST continue to be discovered by the service gate.
Avoid catch-all `utils`, `helpers`, `common`, and `misc` directories: a truly
shared module belongs to the domain that owns its contract, with cross-domain
imports using that contract.

## Recursive domain composition

A multi-file domain MUST expose a narrow entry point for its owning service
or parent domain. The service composition root imports that domain entry
point; the domain entry point imports or explicitly re-exports its subdomain
entry points; each subdomain reaches its own leaf modules. This keeps the
composition root from listing every leaf file and makes ownership visible in
the import graph. Prefer named exports and purpose-specific factories over
unrestricted `export *` barrels. Direct cross-domain imports are permitted
for a specific contract, but a convenience barrel MUST NOT hide a forbidden
architecture dependency or create a cycle. Preserve lazy imports and
initialization order when changing a runtime entry point. Existing long import
preludes migrate by domain when touched.

The Desktop composes through one composition context
(`services/desktop/composition/context/`). `main.mjs` only starts
`composeDesktop()`; ordered stages under `composition/entry/stages/` run each
domain factory over the context and provide its outputs back to it, so a
factory receives every dependency by name without a parameter list being
threaded through the entry point. A stage MUST provide a name at most once
(redefinition throws), MUST ask for a dependency a later stage provides through
`late()` rather than a hand-written forwarder, and MUST keep state access behind
the live views in `composition/state/views.mjs`. Stage-local overrides are
reserved for real renames, deliberately narrowed callbacks and generic names
that must not enter the shared context. `composition/entry/graph/graph.test.mjs`
composes the real Desktop against an inert Electron stub, so a missing
provider, a collision or an initialization-order fault fails the test suite
instead of the next launch. Source-level tests read the flattened composition
through `composition/entry/source.mjs`, never `main.mjs` directly.

For CSS, `styles/index.css` imports ordered domain or cascade entry points,
which import their own subdomain sheets recursively. Aggregators MUST keep
the effective rule order, layers, asset resolution and output CSS unchanged
when the work is only structural; group names alone never justify reordering
the cascade. Go packages already provide entry points through exported APIs:
the command/application composition layer calls package functions, and no
synthetic Go barrel file is required.

File-size limits, the extract-on-touch rule for legacy oversized files, and
continuous-refactoring expectations are defined in `SoT/CODE_QUALITY.md`.
Frontend styling direction (incremental Tailwind CSS migration) is defined in
`SoT/FRONTEND_STYLING.md`. See `adr/ADR-0066`.

Desktop frontend project-owned CSS has one home, `/services/frontend/src/styles`, organized by
domain rather than dropped at the root of `src`:

- `/services/frontend/src/styles/index.css` — single entry point imported by `main.tsx`; new sheets register with their domain aggregator.
- `/services/frontend/src/styles/theme` — design tokens and Light/Dark appearance.
- `/services/frontend/src/styles/base` — resets, element defaults, shared primitives.
- `/services/frontend/src/styles/domains/<surface>` — each product surface owns its styles; no CSS file sits directly in the `domains` container.
- `/services/frontend/src/styles/vendor` — overrides for third-party DOM (Monaco, xterm, Quill).

Creating a `.css` file at the root of `/services/frontend/src` is forbidden.
The six legacy stylesheets already there are frozen: no change adds rules to
them, and anything extracted from one lands in its proper `styles/` domain.
Writing a CSS file at all is the fallback — styling expressible as Tailwind
utilities belongs on the component.

Every linked project root also has an engine-owned `/VERSION` file. Wharnex creates it when missing and is the sole writer; planner patches must never target it. The canonical stored form is four numeric components prefixed by `v` (`vA.B.C.D`).

Orchestrator-specific implementation follows the same boundaries:

- `/services/backend/internal/orchestrator` — project-scoped Plan/Task/TaskRun domain records, DAG/readiness rules and persistence adapter.
- `/schemas/orchestrator-plan.schema.json` — JSON Schema for the planner-only `harness.orchestrator-plan/v1` proposal contract.
- `/services/backend/internal/app/service_orchestrator_*.go` — orchestration use cases and delegation into the existing Agent pipeline.
- `/services/frontend/src/components/orchestrator/{workspace,planning,tasks,overview}` — Overview/Tasks projections and interactions; these are not transition or scheduling authorities.
- `/adr/ADR-0032-orchestrator-mode.md` — accepted responsibility, persistence and concurrency decision.

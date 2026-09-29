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
the domain's implementation and focused tests together. A second directory
level MAY separate cohesive concerns inside a large domain; do not create a
directory solely to satisfy the rule while placing unrelated files inside it.

- Desktop native code: `/services/desktop/<domain>/`. `main.mjs` remains the
  Electron composition entry point; window persistence and recovery belong in
  `window/`, ChatGPT browser state in `chatgpt/`, and subsequent extractions
  follow the capability they own. New root-level Desktop helper files are
  forbidden.
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

File-size limits, the extract-on-touch rule for legacy oversized files, and
continuous-refactoring expectations are defined in `SoT/CODE_QUALITY.md`.
Frontend styling direction (incremental Tailwind CSS migration) is defined in
`SoT/FRONTEND_STYLING.md`. See `adr/ADR-0066`.

Desktop frontend project-owned CSS has one home, `/services/frontend/src/styles`, organized by
domain rather than dropped at the root of `src`:

- `/services/frontend/src/styles/index.css` — single entry point imported by `main.tsx`; new sheets register here.
- `/services/frontend/src/styles/theme` — design tokens and Light/Dark appearance.
- `/services/frontend/src/styles/base` — resets, element defaults, shared primitives.
- `/services/frontend/src/styles/domains` — one sheet per product surface (agent, editor, orchestrator, terminal, git, …).
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
- `/services/frontend/src/components/orchestrator` — Overview/Tasks projections and interactions; it is not a transition or scheduling authority.
- `/adr/ADR-0032-orchestrator-mode.md` — accepted responsibility, persistence and concurrency decision.

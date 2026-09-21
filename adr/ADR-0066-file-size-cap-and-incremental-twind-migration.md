# ADR-0066 — 200-line file cap, extract-on-touch, and incremental Twind migration

- Status: accepted
- Evidence: operator directive, 2026-09-21 (no incident; a proactive quality-gate request)

## Context

`AGENTS.md` §4 already carried a soft target (`New production Go files SHOULD
remain under 250 lines where practical`) with no equivalent for other
languages, no rule for files that are already over any limit, and no
enforcement. In practice the repository has already grown files far past any
reasonable review size: `services/frontend/src/styles.css` is 8459 lines,
`services/desktop/main.mjs` is 8196 lines, `services/frontend/src/theme.css`
is 1703 lines. These are exactly the files hardest to review, hardest to
merge without conflict (see the Git-native conflict machinery this repo
already invests heavily in — `adr/ADR-0054`, `adr/ADR-0065`), and hardest for
a planner or a human to hold in context at once.

Separately, the frontend has no utility-first styling layer. All styling is
hand-written CSS in a small number of ever-growing files. There is no
dependency, config, or convention for anything else yet.

The operator asked for two related but distinct normative changes:

1. A hard file-size cap on new implementation files, plus a mandatory
   extract-on-touch discipline for legacy files that already exceed it, plus
   a standing continuous-refactoring expectation.
2. A gradual (never big-bang) migration of frontend styling onto
   [Twind](https://twind.dev), so new/touched UI work stops adding to the
   monolithic CSS files instead of shrinking them.

## Decision

### File size

- New implementation files (any language: Go, TS/TSX, JS/JSX, MJS/CJS, CSS,
  HTML, and any future implementation language) MUST NOT exceed 200 lines,
  counted with a plain `wc -l`. This applies to test files as well as
  production files — a large test suite is grown as multiple focused files,
  not one growing file.
- This supersedes the softer 250-line Go-only guidance previously in
  `AGENTS.md` §4.
- Editing a legacy file that already exceeds 200 lines MUST extract the
  concern actually being touched/maintained into its own dedicated
  file/module in the same change, rather than adding more code to the
  oversized file. The legacy file is expected to shrink over time through
  this discipline, never through a separate big rewrite.
- Full scope, exemptions (generated code, vendored/third-party, lockfiles,
  data/fixtures/schemas, migrations, build output) and the extract-on-touch
  protocol are defined in the new `SoT/CODE_QUALITY.md`, which this ADR
  creates as the dedicated authoritative document for this area.
- A best-effort verification script, `scripts/check-file-size.sh`, is added
  to make the new-file rule mechanically checkable. Per explicit operator
  choice, it is not wired into `scripts/quality-gates.sh` or CI in this
  change — it is documented and runnable (`make file-size-check`) so it can
  be adopted as a blocking gate deliberately, later, once the existing
  oversized legacy files have had a chance to shrink under the
  extract-on-touch rule instead of the gate immediately failing on files
  nobody touched.

### Frontend styling: incremental Twind adoption

- Twind is adopted as the target utility-first styling engine for the
  frontend, replacing hand-written CSS growth over time. This is declared in
  `SoT/FRONTEND_STYLING.md`, a new dedicated document, rather than folded
  into the behavior-focused `SoT/UI_UX.md`.
- The migration is explicitly incremental, never a rewrite:
  - New components, screens and features MUST be styled with Twind rather
    than adding rules to `styles.css`/`theme.css`/`operational-panels.css`/
    `restart-confirmation.css`.
  - Modifying an existing component that still depends on legacy CSS SHOULD
    migrate the touched styling surface to Twind in the same change,
    whenever practical, mirroring the same touch-triggers-cleanup principle
    as the file-size rule above.
  - No scheduled mass rewrite of the legacy CSS files is authorized or
    planned; they shrink only as their content is touched.
- Adding the actual `twind` dependency/build wiring is a one-time bootstrap
  prerequisite, tracked as follow-up implementation work in
  `SoT/FRONTEND_STYLING.md` rather than performed as part of this
  documentation-only change, so this change stays reviewable as policy and
  the bootstrap lands as its own reviewed, tested change per `AGENTS.md` §6.

### Continuous refactoring

- `SoT/CODE_QUALITY.md` states a standing expectation that code touched for
  any reason is left cleaner than it was found (naming, dead code,
  duplicated logic, oversized functions/files), bounded to the area actually
  touched — this is a continuation of the existing `AGENTS.md` §4 principle
  ("Split responsibilities before files become difficult to review"), not a
  license for unrelated drive-by rewrites.

## Consequences

- `AGENTS.md` §4 now states the 200-line cap and extract-on-touch rule as
  MUST-level invariants instead of a Go-only SHOULD.
- `SoT/QUALITY_GATES.md` gains G11, documenting `scripts/check-file-size.sh`
  as an available, currently non-blocking gate.
- `SoT/PROJECT_STRUCTURE.md` points to both new SoT documents.
- No source code changes in this ADR: no Twind dependency was added, no
  existing file was refactored. Both are intentionally deferred to follow-up
  changes so each lands as its own reviewable, tested unit of work.
- Existing oversized files (`styles.css`, `theme.css`,
  `operational-panels.css`, `restart-confirmation.css`, `main.mjs`, and any
  other legacy file already over 200 lines) are not immediately non-compliant
  violations to fix; they are exactly the population the extract-on-touch
  rule targets going forward.

## Verification

Documentation-only change. `scripts/check-file-size.sh` is exercised
manually (`make file-size-check`) against this change's own new files
(this ADR, the two new SoT documents, the script itself) to confirm none
exceed 200 lines and that the script runs cleanly end to end.

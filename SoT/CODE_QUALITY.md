# Code Quality SoT

This document is the authoritative detail behind `AGENTS.md` §4's file-size
and continuous-refactoring rules (see `adr/ADR-0066`). `AGENTS.md` states the
MUST; this document states scope, exemptions and the enforcement mechanism.

## 1. The 200-line cap on new files

A new implementation file, in any language, MUST NOT exceed 200 lines as
measured by a plain `wc -l`. "New" means the file did not exist before the
change introducing it — it is not about whether the *feature* is new.

This applies to:

- production source files (`.go`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`,
  `.cjs`, `.css`, `.scss`, `.html`, and any future implementation language
  adopted into the repository);
- test files in those same languages (`*_test.go`, `*.test.ts(x)`,
  `*.spec.ts(x)`, `main-*.test.mjs`, etc). A growing test suite is grown as
  additional focused files, one per scenario/unit, not as one file that keeps
  growing.

### Exemptions

The cap does not apply to:

- generated/derived files a human does not hand-edit (protobuf/`*.pb.go`,
  OpenAPI/codegen output, `*.tsbuildinfo`, compiled/minified bundles);
- vendored or third-party code brought in wholesale;
- lockfiles (`package-lock.json`, `go.sum`, `go.mod`);
- data, fixture, schema and migration files that are not application logic
  (`schemas/*.json`, `testdata/**`, `**/fixtures/**`, SQL migrations);
- build output (`dist/`, `build/`, `.harness/`);
- localization/translation resource files;
- sandboxed Electron preload entry points (`services/desktop/preload.cjs`).
  Electron loads a preload for a `sandbox: true` window with a `require`
  polyfill that resolves only `electron` and a few Node builtins, so a
  relative import throws, the preload aborts, and the trusted renderer silently
  loses its privileged bridge — losing the themed window controls and the
  native ChatGPT surfaces with it. Splitting such a file is therefore not a
  refactor but an outage, and it MUST stay self-contained. Its contract is
  enforced by `services/desktop/preload-sandbox.test.mjs` instead of by the
  line cap. Growth is still bounded: behavior belongs in main-process modules
  the preload reaches over named IPC, never in the preload itself.

When in doubt whether a file is "implementation" for this rule, prefer
splitting it — the cost of one extra small file is far lower than the cost of
reviewing, merging or asking a planner to reason about an oversized one.

## 2. Extract-on-touch for legacy oversized files

A file that already exceeds 200 lines before your change is not, by itself,
a violation to fix as a separate cleanup task. It becomes one the moment a
change needs to touch it: that change MUST extract the concern it is
adding/maintaining into its own new, dedicated file or module, in the same
commit, rather than adding more lines to the oversized file.

Extract-on-touch never applies to a file §1 exempts. A file whose runtime
cannot load a second module is extracted only by breaking it, so the concern
is moved behind the boundary that file already talks to — for a sandboxed
preload, a main-process module reached over named IPC — never into a sibling
the file would have to import.

Concretely:

- identify the cohesive piece of behavior your change actually needs to add
  or maintain inside the oversized file;
- move that piece (or write the new piece) into a new file that itself
  respects the 200-line cap, named for the concern (a dedicated
  file/domain), not for "this is where the exception went";
- have the legacy file import/call into the new file, so the legacy file's
  own line count goes down or stays flat rather than growing;
- do not attempt to extract the *entire* legacy file in the same change
  unless that is the change being asked for — extract only what you are
  touching. The legacy file shrinks over many such changes, never through one
  big rewrite forced into an unrelated task.

This is how `services/frontend/src/styles/legacy/styles.css` (10119 lines),
`services/desktop/main.mjs` (8196 lines) and
`services/frontend/src/styles/theme/theme.css` (1791 lines) are expected to
shrink over time. The two stylesheets were relocated out of the root of
`src/` by the wholesale move recorded in `SoT/FRONTEND_STYLING.md` §1; that
changed where they live, not the fact that they shrink only through
extract-on-touch. None of them is being rewritten as part of `adr/ADR-0066`; each next
change that touches one of them is where the shrinking happens.

## 3. Continuous refactoring

Code you touch for any reason — a bug fix, a small feature, an extract-on-
touch split — MUST be left cleaner than you found it, bounded to the area you
actually touched: clearer naming, removal of dead code you can see is dead,
collapsing obvious duplication, splitting an oversized function you had to
read anyway. This is a continuation of the existing `AGENTS.md` §4 principle
("split responsibilities before files become difficult to review"), not
authorization for unrelated drive-by rewrites in the same change — an
unrelated cleanup is its own change.

## 4. Enforcement

`scripts/check-file-size.sh` is the mechanical check for the new-file rule
(§1). It compares the current working tree against a base ref (default: the
merge-base with `main`) and reports every new, extension-matched,
non-exempt file over 200 lines. Run it with:

```bash
make file-size-check
```

or directly:

```bash
scripts/check-file-size.sh [base-ref]
```

Per `adr/ADR-0066`, this script is **not** currently wired into
`scripts/quality-gates.sh` or CI (see `SoT/QUALITY_GATES.md` G11) — it is a
manually-run, documented gate. It exists so the rule is checkable today and
can be promoted to a blocking gate deliberately once adopted.

The extract-on-touch rule (§2) and continuous refactoring (§3) are review
discipline, not mechanically checkable; they are enforced in code review
against this document.

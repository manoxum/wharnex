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
  enforced by `services/desktop/bridge/preload-sandbox.test.mjs` instead of by the
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
- place the extracted file and its focused tests under the owning domain or
  subdomain directory (see `SoT/PROJECT_STRUCTURE.md`), never as another flat
  sibling or in an overfull domain directory;
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

### Mandatory post-change refactoring pass

Every implementation, bug fix or evolution — whether written by a human, a
coding agent or the Wharnex planner — ends with a refactoring pass before it is
complete. Making the behavior work is the first half of the change, not the
whole of it. The pass covers the code *related* to the change: the files it
edited, the modules it calls into or that call into it for the touched
behavior, and the tests that verify it. In that scope the pass MUST:

- bring every touched file to the §1 cap, extracting by concern under the owning
  domain (§2) rather than by line count;
- remove dead code, obsolete compatibility paths and stale test scaffolding
  the change made unreachable or that it can prove unused;
- collapse duplication the change introduced or exposed, preferring an existing
  domain contract over a new helper;
- keep names, comments and structure such that the next maintainer (human or
  model) can understand the concern by reading the fewest files — this is the
  token-economy goal of the cap, not an aesthetic preference;
- rerun the gates the change already required after the refactor, since a
  refactor that is not verified is a new unverified change.

The pass is bounded by relation, not by ambition: it does not authorize
rewriting unrelated concerns, and behavior MUST NOT change in it. When the
related code is too large to bring to standard within the change, the pass
extracts the touched concern (§2) and records the remainder as named follow-up
debt in the change description instead of silently leaving it.

## 4. Rename-on-touch from Wharness to Wharnex

Wharnex is the canonical product nomenclature. New project-owned work MUST use
`Wharnex`/`WHARNEX` in product prose and `wharnex`/`WHARNEX_*` when a
product-name token is needed in technical identifiers. New implementation MUST
NOT mint `Wharness`, `wharness-*`, `WHARNESS_*`, `wharness.*`, or an equivalent
legacy spelling merely because nearby code still uses it.

Legacy Wharness naming is migration debt and is governed by rename-on-touch. A
change that maintains or evolves a concern containing that nomenclature MUST
migrate the touched concern in the same change, even when renaming was not the
primary purpose of the task. The migration includes the directly related,
project-owned surface needed to keep the concern coherent: symbols and types,
constants and selectors, tests and fixtures, documentation labels, configuration
keys and paths, and internal call sites. Do not create a new legacy alias to
avoid updating those references.

The obligation is bounded to the cohesive concern being changed. It does not
authorize a repository-wide rename just because the same legacy token appears
elsewhere, and it does not require rewriting unrelated behavior in a large file.
Like extract-on-touch, the repository converges incrementally as maintained
surfaces are migrated.

Compatibility is the only exception. An already-shipped identifier MAY retain
its exact legacy spelling when changing it would break an external or persisted
contract, including wire/protocol identifiers, persisted database/storage keys
or paths, environment variables or CLI inputs, and artifact/bundle names. In
that case the change MUST:

- keep the legacy spelling only at the narrow compatibility boundary;
- map immediately to canonical Wharnex naming inside new or maintained code;
- avoid introducing new internal consumers of the legacy spelling; and
- preserve a compatibility test when the old identifier remains supported.

When a safe compatibility migration can provide both names, Wharnex is the
canonical write/output path and the legacy spelling is read/accept-only until a
separately reviewed removal. User-visible prose that is not itself a compatibility
identifier has no exemption and MUST say Wharnex when touched.

Reviewers and planners MUST treat any newly added, unexempted legacy Wharness
product token as a defect. If a diff adds one intentionally for compatibility,
the change description and test coverage must make the compatibility boundary
explicit rather than leaving the exception implicit.

## 5. Enforcement

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

The extract-on-touch rule (§2), continuous refactoring (§3), and naming
migration rule (§4) are review discipline, not mechanically checkable; they are
enforced in code review against this document.

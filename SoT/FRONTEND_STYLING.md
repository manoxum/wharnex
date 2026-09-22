# Frontend Styling SoT

This document is the authoritative detail behind `AGENTS.md` §4's styling
rules (see `adr/ADR-0066`). It governs how `services/frontend` styling is
built and where it lives; `SoT/UI_UX.md` remains authoritative for what the
UI must look like and how it must behave.

## 1. Current state (measured 2026-09-22)

All frontend styling today is hand-written CSS, concentrated in six legacy
files. They no longer sit flat at the root of `src/`: the wholesale
relocation §4 reserved for an explicitly requested change has been carried
out, so `src/` now holds no stylesheet at all and every sheet is reached
through the single `src/styles/index.css` entry point:

| file | lines |
| --- | --- |
| `src/styles/legacy/styles.css` | 10119 |
| `src/styles/theme/theme.css` | 1791 |
| `src/styles/domains/operational-panels.css` | 812 |
| `src/styles/domains/plan-control.css` | 669 |
| `src/styles/domains/restart-confirmation.css` | 357 |
| `src/styles/domains/activity-history.css` | 193 |

The move was content-preserving and cascade-preserving: the files were
relocated with `git mv`, and `index.css` reproduces the exact order
`main.tsx` previously applied, which is what keeps appearance identical
(the production CSS bundle hashes identically before and after). Relocation
does not unfreeze them — §4's rule that no change may add rules to these six
files still applies, and `src/styles/legacy/` exists to hold the one
monolith that has not been decomposed into domains yet, not as a
destination for new sheets.

`styles.css` grew by roughly
1800 lines in a single day (8459 → 10257) *after* the first version of these
rules landed, which is the concrete evidence that a stated preference is not
enough: §3 and §4 below are written as obligations with named exceptions,
not as encouragement.

Three properties of this stylesheet decide everything about how a migration
can proceed safely, and each is a measured fact, not an assumption:

- **No `@layer` is used anywhere.** Every legacy rule is unlayered.
- **Appearance is already tokenised.** Colours come from CSS custom
  properties on `:root` (`--theme-bg`, `--theme-text`, `--theme-accent`,
  `--theme-border`, …), and Dark mode is the same tokens redefined under
  `:root[data-theme='dark']`.
- **Typography is scale-dependent.** Sizes are written as
  `calc(<n>px * var(--ui-font-scale))` to honour the persisted UI scale
  required by `SoT/UI_UX.md`.

## 2. Decision: Tailwind CSS, adopted incrementally

[Tailwind CSS](https://tailwindcss.com) is the target styling engine for the
frontend. The migration is explicitly incremental — there is no scheduled or
authorized big-bang rewrite of the files in §1. They shrink only as the code
that uses them is touched, the same extract-on-touch spirit as
`SoT/CODE_QUALITY.md` §2.

### Why this cannot silently break untouched UI

Because all legacy CSS is unlayered and Tailwind emits its utilities inside
cascade layers, **unlayered legacy rules win over Tailwind utilities
regardless of specificity**. Introducing Tailwind therefore cannot restyle a
component nobody migrated: for an untouched component the legacy rule still
decides. The same fact is the migration's main working constraint — see §3.

## 3. Migration is mandatory for what you touch

- **New** components, screens and features MUST be styled with Tailwind
  utility classes. They MUST NOT add rules to any file in §1.
- A change that modifies or evolves an **existing** component MUST migrate
  the styling surface it is touching to Tailwind in that same change. This
  is an obligation, not a preference: "I only changed the logic" is not an
  exemption when the change also restyles, respaces or re-colours that
  component.
  - The obligation is scoped to what the change touches. It never requires
    migrating the rest of the component, its siblings, or the file its rules
    happen to live in.
  - Exceptions are narrow and MUST be named explicitly in the change
    description, never applied silently: styling entangled with the shared
    cascade such that migrating it would require a wider change than the
    task at hand; a third-party surface (Monaco, xterm, Quill) styled
    through selectors Wharnex does not own; or a construct utilities cannot
    express (§4).
- A component partially migrated (some Tailwind, some legacy class names) is
  an acceptable intermediate state.
- Migrating a component MUST delete that component's legacy rules in the
  same change. Leaving them behind does not merely duplicate them: per §2
  they keep overriding the new utilities, so the component silently keeps
  its old styling and the migration is a no-op the author believes landed.
- Tailwind classes MUST resolve through the existing design tokens
  (`--theme-*`, `--ui-font-scale`), never through hardcoded literals or
  Tailwind's stock palette/type scale. Visual parity is the acceptance
  criterion, and the tokens are what already guarantee Light/Dark parity and
  the persisted UI scale required by `SoT/UI_UX.md`.

## 4. Where CSS lives

Writing a new `.css` file is the fallback, not the default. Before creating
one, §3 applies: if the styling can be expressed as Tailwind utilities on
the component, it MUST be, and no CSS file is created at all. A new CSS file
is justified only for what utilities genuinely cannot express — design
tokens and theme definitions, global resets/base rules, keyframes, and
overrides targeting third-party DOM (Monaco, xterm, Quill) whose markup
Wharnex does not author.

When a CSS file *is* justified:

- It MUST live under `services/frontend/src/styles/`, the dedicated styling
  domain. Project-owned CSS MUST NOT be created anywhere else — above all
  not at the root of `src/`, which is what happened to the six files in §1.
- It MUST be organized by domain inside that directory, named for the
  surface it styles, not for the change that created it:
  - `src/styles/index.css` — the single entry point imported by `main.tsx`,
    which aggregates the rest. New sheets are registered here rather than
    lengthening the import list in `main.tsx`.
  - `src/styles/theme/` — design tokens and appearance (Light/Dark).
  - `src/styles/base/` — resets, element defaults, shared primitives.
  - `src/styles/domains/` — one sheet per product surface (agent, editor,
    orchestrator, terminal, git, …).
  - `src/styles/vendor/` — overrides for third-party DOM.
- Each file is subject to the 200-line cap in `SoT/CODE_QUALITY.md` §1, like
  any other new implementation file. Splitting a domain sheet that would
  exceed it is expected, not an exception to request.
  - `src/styles/legacy/` — the undecomposed monolith only. Nothing new is
    ever added here; it shrinks as domains are extracted out of it.
- The six legacy files in §1 are **frozen**: no change may add rules to
  them. Anything extracted from one of them under the extract-on-touch rule
  lands in `src/styles/` in its proper domain, and the legacy file shrinks
  accordingly. Their wholesale relocation into `src/styles/` was such an
  explicitly requested change and has now happened (§1); being frozen is
  about their contents, not their path, so it still holds. The 200-line cap
  applies to new sheets, not retroactively to these six.

## 5. Bootstrap requirements

Adding the dependency and build wiring is a one-time prerequisite before any
component can migrate, and §3's obligation cannot be satisfied until it
lands. It is its own reviewed, tested change under the normal `AGENTS.md` §6
protocol — it is **not** part of `adr/ADR-0066`. That change MUST satisfy
every constraint below, each of which protects existing appearance:

- **Preflight (Tailwind's base reset) MUST NOT be enabled globally.** The
  legacy stylesheet relies on browser defaults in places; a global reset
  changes those defaults underneath 10257 lines of CSS nobody is reviewing
  in that change. Import Tailwind's theme and utilities layers without the
  preflight layer.
- **The theme is generated from the existing tokens**, so a utility resolves
  to `var(--theme-*)` rather than a Tailwind colour. Because those tokens
  already swap under `:root[data-theme='dark']`, a correctly configured
  utility themes itself with no `dark:` variant at all; a `dark:` variant, if
  ever configured, MUST follow the project's `data-theme` attribute and not
  `prefers-color-scheme`, which is only the default *System* preference.
- **The type scale MUST stay multiplied by `var(--ui-font-scale)`.**
  Tailwind's stock fixed sizes would silently opt migrated components out of
  the persisted UI scale.
- **Class names MUST be statically analysable.** Tailwind generates only the
  classes it can see in source; a constructed name such as
  `` `text-${tone}` `` produces no CSS and renders unstyled. Use complete
  class strings selected by a lookup/`switch`, never string interpolation.
- Vite plugin wiring belongs in the existing `vite.config.ts` plugins array.
- The change MUST pass `npm run typecheck`, `npm run lint`,
  `npm test -- --run` and `npm run build`, and MUST state that it produced no
  visual change — at bootstrap, nothing is migrated yet, so any visual
  difference is a defect in the bootstrap itself.

Until that bootstrap lands, §3's Tailwind obligation is suspended and new
work continues on legacy CSS — but §4 applies immediately and in full: a new
sheet goes to `src/styles/`, never to the root of `src/`, and the six legacy
files stay frozen. New work SHOULD also be written so the eventual migration
is mechanical (component-scoped class names, no reliance on unrelated global
selectors bleeding into the component).

## 6. Non-goals

- This is not a design refresh. Visual output before and after migrating any
  given component MUST be unchanged, per `SoT/UI_UX.md`.
- This does not authorize removing `theme.css`'s token definitions. Tailwind
  consumes those tokens; it does not replace them.
- This does not extend to `services/desktop/main.mjs` or other non-CSS
  legacy files — those are governed by `SoT/CODE_QUALITY.md`'s
  extract-on-touch rule, not by this document.

# Frontend Styling SoT

This document is the authoritative detail behind `AGENTS.md` §4's styling
rules (see `adr/ADR-0066`). It governs how `services/frontend` styling is
built and where it lives; `SoT/UI_UX.md` remains authoritative for what the
UI must look like and how it must behave. The independent `services/webapp`
remote application is Tailwind-first and owns its own styling entry point;
these legacy Desktop stylesheet-location rules do not make it a frontend build mode.

## 1. Current state (measured 2026-09-29)

The Desktop frontend combines legacy CSS and incremental Tailwind utilities.
No stylesheet sits flat at the root of `src/`; every sheet is reached through
the single `src/styles/index.css` entry point. Cascade stage, legacy chapter,
domain and palette aggregators recursively import their own ordered leaves:

| location | current shape |
| --- | --- |
| `src/styles/index.css` | four ordered stage imports |
| `src/styles/legacy/styles.css` | six ordered chapter imports leading to 62 domain sheets |
| `src/styles/theme/theme.css` | four palette group imports leading to 12 palette sheets |
| `src/styles/domains/` | surface directories only; no direct CSS files |
| largest CSS leaf | `src/styles/domains/activity/activity-history.css`, 194 lines |

The split preserved every declaration and its cascade order. Expanding the
recursive imports reproduces the prior `styles.css` and `theme.css` rules, and
the production build still emits `index-CaOcUVqi.css`, the same CSS bundle
hash as before the split. New styling follows §3 and §4; aggregators are
composition entry points, not places for new rules. Existing domain sheets
shrink as their owning surfaces migrate to Tailwind.

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
authorized big-bang visual or Tailwind rewrite of the files in §1. The
operator authorized a structural split of the oversized legacy and theme
sheets on 2026-09-29: existing rules MAY move into ordered, domain-owned
stylesheets without changing selectors, declarations, cascade order, or
appearance. This is a file-organization change, not a shortcut around the
incremental Tailwind migration. New rules still follow §3 and §4; after the
structural split, legacy rules shrink only as the code that uses them is
touched, in the extract-on-touch spirit of `SoT/CODE_QUALITY.md` §2.

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
  not at the root of `src/`, where six legacy stylesheets formerly lived.
- It MUST be organized by domain inside that directory, named for the
  surface it styles, not for the change that created it:
  - `src/styles/index.css` — the single entry point imported by `main.tsx`,
    which imports a small ordered set of domain/cascade aggregators. Each
    aggregator imports its own subdomain sheets recursively; new leaf sheets
    are registered with their owner, not appended to `main.tsx` or a flat
    import list in `styles/index.css`. Aggregation MUST preserve cascade order.
  - `src/styles/theme/` — design tokens and appearance (Light/Dark).
  - `src/styles/base/` — resets, element defaults, shared primitives.
  - `src/styles/domains/<surface>/` — CSS grouped by product surface (agent,
    editor, orchestrator, terminal, git, …), then by a named concern where
    needed. No project-owned CSS file lives directly in `styles/domains/`;
    that directory is only a container for surface directories.
  - `src/styles/vendor/` — overrides for third-party DOM.
  - `src/styles/legacy/` — ordered import manifests for the rules split from
    the former root stylesheet. New declarations belong to their owning
    surface, never to a legacy manifest.
- Each file is subject to the 200-line cap in `SoT/CODE_QUALITY.md` §1, like
  any other new implementation file. Splitting a domain sheet that would
  exceed it is expected, not an exception to request.
- The legacy declarations represented by the sheets in §1 are **frozen**:
  file moves and ordered import composition may preserve them, but new UI
  styling follows §3. An owner migrating a surface to Tailwind removes its
  corresponding legacy declarations in the same change. The 200-line cap
  applies to all newly created sheets and split leaves.

## 5. Bootstrap requirements

Tailwind CSS v4 and its Vite plugin are installed for the Desktop frontend.
The active configuration MUST keep these constraints, each of which protects
the existing appearance:

- **Preflight (Tailwind's base reset) MUST NOT be enabled globally.** The
  legacy stylesheet relies on browser defaults in places; a global reset
  changes those defaults underneath the legacy cascade. Import Tailwind's
  theme and utilities layers without the preflight layer.
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
- Styling changes MUST pass `npm run typecheck`, `npm run lint`,
  `npm test -- --run` and `npm run build`, with visual parity verified for
  the surface touched. The Tailwind obligation in §3 is active.

## 6. Non-goals

- This is not a design refresh. Visual output before and after migrating any
  given component MUST be unchanged, per `SoT/UI_UX.md`.
- This does not authorize removing `theme.css`'s token definitions. Tailwind
  consumes those tokens; it does not replace them.
- This does not extend to `services/desktop/main.mjs` or other non-CSS
  legacy files — those are governed by `SoT/CODE_QUALITY.md`'s
  extract-on-touch rule, not by this document.

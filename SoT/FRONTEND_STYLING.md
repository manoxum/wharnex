# Frontend Styling SoT

This document is the authoritative detail behind `AGENTS.md` §4's styling
rule (see `adr/ADR-0066`). It governs how `services/frontend` styling is
built going forward; `SoT/UI_UX.md` remains authoritative for what the UI
must look like and how it must behave.

## 1. Current state

All frontend styling today is hand-written CSS, concentrated in a small
number of files that have grown far past reviewable size:

- `services/frontend/src/styles.css` — 8459 lines
- `services/frontend/src/theme.css` — 1703 lines
- `services/frontend/src/operational-panels.css` — 597 lines
- `services/frontend/src/restart-confirmation.css` — 357 lines

There is no utility-first styling layer and no `twind`/Tailwind dependency
in `services/frontend/package.json` as of this document.

## 2. Decision: Twind, adopted incrementally

[Twind](https://twind.dev) is the target styling engine for the frontend.
The migration is explicitly incremental — there is no scheduled or
authorized big-bang rewrite of the files in §1. They shrink only as the code
that uses them is touched, the same extract-on-touch spirit as
`SoT/CODE_QUALITY.md` §2.

### Rules

- **New** components, screens and features MUST be styled with Twind utility
  classes, not by adding rules to any of the legacy CSS files.
- When a change modifies an **existing** component that still styles itself
  through legacy CSS, the touched styling surface SHOULD be migrated to
  Twind in that same change whenever practical. "Whenever practical" means:
  do it when the component's styling is cohesive enough to move without a
  disproportionate, out-of-scope rewrite; skip it and say so in the change
  when the component's styling is tightly entangled with the shared
  cascade (theme tokens, global resets) in a way that would require a wider
  change than the task at hand.
- A component partially migrated (some Twind, some legacy class names) is an
  acceptable intermediate state. It is not acceptable to add *new* legacy
  CSS rules to a component while leaving its existing rules untouched — new
  styling on a touched component goes to Twind.
- Every Twind class used MUST resolve through the shared theme tokens
  already required by `SoT/UI_UX.md` §"Appearance themes" (Light/Dark
  parity, the calibrated semantic execution/safety palettes, the persisted
  UI scale). A Twind migration MUST NOT hardcode a color or size that
  bypasses those tokens — configure Twind's theme from the same source of
  truth `theme.css` currently defines, not with ad hoc literals per
  component.

## 3. Bootstrap is separate follow-up work

Adding the `twind` dependency, its build/Vite wiring, and the initial theme
token bridge is a one-time prerequisite before any component can actually
migrate. That bootstrap is deliberately **not** part of `adr/ADR-0066` (a
documentation-only change) — it lands as its own reviewed, tested change
under the normal `AGENTS.md` §6 change protocol, so the dependency addition,
config, and the theme-token bridge can each be verified (`npm run
typecheck`, `npm run lint`, `npm test -- --run`, `npm run build`) rather than
bundled into a policy document.

Until that bootstrap change lands, "new UI work MUST use Twind" has no
effect yet — new work continues on legacy CSS, but SHOULD be written so the
eventual migration is mechanical (component-scoped class names, no reliance
on unrelated global selectors bleeding into the component).

## 4. Non-goals

- This is not a design refresh. Visual output before and after a Twind
  migration of any given component MUST be unchanged, per `SoT/UI_UX.md`.
- This does not authorize removing `theme.css`'s token definitions; Twind
  configuration consumes them, it does not replace them.
- This does not extend to `services/desktop/main.mjs` or other non-CSS
  legacy files — those are governed by `SoT/CODE_QUALITY.md`'s
  extract-on-touch rule, not by this document.

# Wharnex Product Polish / Workbench Intelligence

## Audit

The existing workbench already owned project-scoped panel sizes, a reversible
concentration mode, shared tab/button/popover primitives and mounted terminal
instances. These remain the foundation. The changes below refine those owners.

| Finding | Owner | Change |
| --- | --- | --- |
| Empty restored Problems consumed the full saved bottom height | OperationalWorkbench | A permanent compact utility strip; explicit expansion stored separately from preferred height |
| Bottom maximize replaced the manual height | OperationalWorkbench | Temporary maximize/restore, without writing preferred height |
| Diagnostics headers and metrics consumed most of a 275 px utility panel | ExecutionErrorsDrawer | An embedded presentation with compact filters; distribution stays available in the shared popover |
| Side tools could reduce primary content to a recovery width | WorkspaceSideRail | Projected per-tool bounds and a primary workspace reserve; a right overlay when readable minima cannot fit |
| Viewport constraints could be confused with preferred geometry | Layout | Projection never writes the user's saved widths |
| Pointer cancellation and keyboard adjustment were incomplete | Panel separators | Arrow/Home/End adjustment, pointer-cancel cleanup and restored cursor/text selection |
| Compact topbar mixed inclusive legacy breakpoints with exclusive utility breakpoints | WorkspaceTopbar | One Tailwind geometry owner, content-sized compact rows and containment assertions at 900 px |
| Settings had a frozen unlayered 1160 px rule | SettingsFrame | Removed the superseded rule; simple categories use a smaller surface and explicit manual sizes take precedence |
| Context loading used an empty region and spinner | Settings context presentation | Contextual skeletons and actionable error/retry states |
| Brand, running and selection had overlapping presentation | Theme, Explorer, Docker, Orchestrator | Semantic surface aliases; selection and running separated from success; quieter state labels |
| Operational counts competed with the Orchestrator objective | OrchestratorActivity | Flat typography and spacing, retaining every metric, slot and review action |
| Explorer Git decorations and Git commit chrome competed with names/content | Explorer and Git | Plain semantic decorations and a clearer commit form without an enclosing card |

## Spatial contract

The primary workspace reserves 42% of the row, bounded between 360 and 560 px.
Supporting tools retain their preferred width when room permits. Explorer uses
200–420 px, Git 320–560 px, Docker/Database 320–720 px, agent tools 300–640 px,
and other supporting tools 260–560 px. Width reductions borrow only the slack
above those minima. If two readable tools cannot fit, the right tool overlays
the workbench. Existing compact-window overlay behavior is preserved.
A single technical tool also overlays if its minimum would compress the primary
workspace; divider accounting stays stable when an overlay hides its divider.

These are live presentation bounds. Stored dimensions are not reset when the
window shrinks. Returning to a larger viewport restores the preferred widths.
An explicit resize gives that side priority; the opposite tool yields its slack
above its minimum. This priority is project-scoped and survives reopening. It
prevents a growing gesture from being projected back into a smaller panel when
both stored preferred widths were larger than the available budget.

The bottom strip is 40 px when collapsed. Empty or unconfirmed Problems restored
without explicit expansion stays compact; unconfirmed data never displays a zero
badge. Clicking a utility tab or resizing records explicit expansion. A later
empty result cannot undo that choice. Maximize is temporary; keyboard/pointer
resizing changes the stored manual height. All utility panes keep the terminal
component mounted. Existing explicit terminal activation/run requests still
select the actual terminal tool and do not replay commands on tab switches.

Escape leaves concentration only after dialogs and popovers have had the chance
to consume it. The main activity, panel selections and saved dimensions survive.

## Surface and refactoring boundaries

The theme now names workspace, side, raised, control, selection, popover and
running roles alongside the existing app background/hover/status tokens.
Aliases resolve through the selected palette. The original Wharnex palette has
more readable metadata and a distinct success colour. Resource tab treatment
continues to follow the named exceptions in `SoT/TABS.md`.

The changed UI uses existing Tailwind primitives. Dedicated obsolete side-panel,
Docker state, Orchestrator cockpit, topbar geometry and Settings loading/root-size CSS was removed.
Shared legacy `.agent-drawer` and native-window rules still serve existing
surfaces; the bounded shared-cascade exception from `FRONTEND_STYLING.md` applies
to their important utility overrides. Embedded diagnostics retain standalone
diagnostic CSS because the standalone drawer still uses it.

Resize behavior was extracted from the oversized App into the utility owner;
Docker row/state presentation and Settings loading were extracted from their
legacy files. Orchestrator activity now has a focused component. New source and
test files remain below 200 lines and use named domain entry points.

The previous CSS test that required a uniform fifth for every drawer was updated
to assert the newly requested nonuniform allocation and useful primary reserve.
Its existing checks against accidental CSS width floors remain. Explorer's
selection assertions now require the selection token rather than brand accent.
The topbar 44 px assertion now checks the equivalent Tailwind `h-11` owner;
browser assertions additionally verify that every child stays inside the header.
No failing functional assertion was relaxed to hide a regression.

## Validation

The executable matrix is `services/frontend/e2e/workbench/polish.spec.ts`, together
with the existing experience, administration and editor-order suites. It uses
the shipped components and Monaco workers with isolated local fixture data.
Screenshots are emitted under `services/frontend/test-results/`; the reviewed set
is also retained temporarily at `/tmp/wharnex-product-polish-review/`.
The topbar was additionally measured at 600, 700, 899, 900 and 901 px: every
child stayed inside the header, with 75 px compact and 44 px normal heights.

Final results: 18/18 browser tests passed; typecheck, production build and
changed-file lint passed. The full unit run had 1383 passing and the same 63
baseline failures (42 files), with no new failing test names. Final topbar tests
passed 7/7; the focused style suite retained only its two baseline failures.
Full lint retains three pre-existing Drawio errors.

The machine-readable results and baseline comparison are recorded in
`product-polish-validation-2026-10-16.json`. The prior full-suite baseline is
`/tmp/wharnex-editor-popovers-final.json` (63 failing tests); failures are compared
by test name rather than only by total count.

The visual review covers editor alone, Explorer/editor, Git/editor, Docker/editor,
Agent, Orchestrator, browser monitor frame, terminal utility frame, Problems empty
and with a diagnostic, Settings loading/compact/manual/maximized, and compact and
maximized desktop dimensions. Light, Darcula, original Wharnex and 125% UI scale
are represented across the suites.

Authenticated native browser pixels, a real human Host PTY, live agent execution,
and mutating Git/Docker operations are not exercised by these fixture screenshots.
Their existing functional test coverage is retained; this review does not claim
those integrations were manually validated. No backend/IPC/protocol/schema change
or independent remote webapp change was needed.

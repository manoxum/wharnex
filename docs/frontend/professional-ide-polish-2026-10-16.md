# Wharnex — Professional IDE polish

## Surface audit before implementation

| Role | Existing owners | Finding / direction |
| --- | --- | --- |
| Primary workspace | EditorWorkspace, ChatPanel, OrchestratorWorkspace, browser frame, Git diff | Preserve mounted resources, natural document widths and the existing primary reserve. |
| Tool window | WorkspaceSideRail / WorkspaceDrawerContent: Project, Git, Docker, TODO, tasks, agents, Codex, library, knowledge, evolution, database, UI Lab, errors, attention, archives | Existing dock position and width persistence; add reversible local maximize and expose existing move/pin operations through the common panel menu. |
| Utility panel | OperationalWorkbench: Terminal, Problems, Output | Already compact for empty restored Problems; keep explicit expansion and mounted PTYs. |
| Navigation | WorkspaceNavigation, mode switch, resource tabs | Existing shared icons/tabs. Improve keyboard navigation without displacing drag/drop or selected resources. |
| Floating surface | ControlPopover, CommandPalette, EditorSearchPalette, resource menus | Keep anchored portal geometry. Consolidate file and action discovery in the command palette, with compact grouped results and shortcuts. |
| Dialog | InternalWindow, SettingsFrame, confirmations | Preserve window sizing, search/categories and confirmation boundaries. |
| Inspector | Agent detail, execution detail, UI test strategies | UI tests repeat card chrome and strategy content; move technical detail behind row disclosure, retain all fields. |
| Status / feedback | WorkbenchStatusBar, StatusBadge, UITestStatus, event status | UI Lab uses brand colour for running and pills for all states; use consistent icon + semantic text. |

## Compatibility boundaries

No API, IPC, authentication, executor or event contract changes. Existing
resource-tab exceptions in TABS.md remain authoritative. UI Lab exposes run and
sync operations; no native Debug/Stop capability exists in its API, so this
phase must not invent those controls or simulate their execution.

The working tree contains earlier accepted polish changes. This phase builds on
them and does not revert them. Baseline unit report:
`/tmp/wharnex-product-polish-final-suite.json` (1383 passed, 63 existing failures).

## Implemented

- Tool-window options share maximize/restore and the existing move/pin callbacks.
  Maximization does not reparent/remount content or write preferred dimensions.
  Opening a different tool retires it; nested dialogs retain Escape priority.
- Stripe selection uses a restrained marker; arrow keys and Home/End move focus
  without executing another tool. Drag, drop, badges and pin targets remain.
- Search Everywhere includes actual project file results alongside commands,
  tools, Agent, Codex, Orchestrator, tasks and the Settings entry. Search handles
  paths, multiple terms and accents. Initial rendering is bounded to 100 results,
  with an explicit action to reveal all remaining results. Loading/retry is real.
- Zen hides secondary chrome temporarily, with an explicit exit and Escape.
  Existing focus mode and every saved panel width/height remain independent.
- The status bar recedes to 28 px controls with readable type.
- UI Lab replaces the metrics dashboard with compact counts and environment/test
  rows. States use Lucide icons plus text; running is distinct from brand/success.
  Metadata is plain text, strategies remain expandable, durations derive only
  from completed run timestamps, and rerun-failed preserves configuration guards.
  The panel now shares the IDE header, loading skeleton and explicit close action.
- Evolution events use a flat technical timeline, semantic labels and lazy JSON.
  The dossier shares the IDE header and control primitives. Filters adapt to the
  panel's own width; redundant metrics/pills and native-looking buttons recede.
- Fixed an observed focus race: Monaco's deferred model/reveal focus could dismiss
  a tool popover the user had just opened. The extracted focus policy yields to
  external dialogs/menus and retains ordinary editor focusing.
- Added explicit info/focus/disabled aliases to the existing semantic tokens.

## Refactoring and styling boundaries

New implementation and test files stay below 200 lines in named domains.
The touched oversized App root presentation was extracted into the layout owner;
Monaco focus policy was extracted from CodeEditor. Dossier filters/header now
compose through the evidence entry point. Shared legacy rail/panel-toolbar rules
also serve embedded Agent chrome: their unchanged cascade is the named bounded
exception; migrated controls use explicit shared Tailwind primitives. No frozen
root stylesheet received a new rule. No dependency was added.

## Validation scope and remaining coverage

Browser tests use actual shipped React components and Monaco with isolated
fixture records. The UI Lab fixture contains passed, failed, running, queued and
skipped scenarios; the dossier fixture contains individual real-shaped events.
These records are confined to E2E code and are never production placeholders.

The existing matrix covers editor, Explorer, Git/diff, Docker, Agent, Orchestrator,
terminal frame, Problems empty/error, Settings, browser monitor, many tabs,
popovers, narrow/large windows, Light/Darcula/original palettes and 125% scale.
New cases cover combined file search, tool maximize/restore, Zen, test rows and
technical timeline filtering/selection/expansion. Native terminal rendering,
Monaco internals and external websites are not restyled.

No authenticated account, live Host PTY, Docker mutation, Git mutation or actual
remote test/agent execution is claimed as manually validated. UI Lab Debug/Stop
and arbitrary Settings-category navigation are not available in the existing
narrow frontend contracts; no mock controls or broad IPC were introduced.

## Final visual review corrections

The before/after dossier captures use the same 1440×900 viewport, selected event
and expanded payload. At that width the filters now occupy one row instead of
three; selection and analysis use shared buttons rather than native chrome.

The test runner now uses one summary row per test: name, icon/status and recorded
duration. Expanding that row exposes goal/description, access/profile, category,
priority, dependencies, saved session, original request, preconditions, steps,
expected result and test data. Failures remain visible even while details are
collapsed. Multi-selection remains independent of disclosure.

Orchestrator's remaining Overview/Tasks pill navigation was extracted into a
focused header using shared workbench tabs and a 40 px header row. The old header,
pill, refresh and breakpoint CSS was removed. The existing notification-routing
assertion now verifies the selected Tasks **tab** via aria-selected instead of a
button CSS class; its refresh and selected-task checks remain. The status-bar
height assertion now requires the requested 28 px minimum rather than 36 px.
These update the authorized presentation contract, without dropping assertions
about navigation, task targeting, selection or stored layout.

## Gate results

| Gate | Result |
| --- | --- |
| Typecheck / production build | Passed; existing large-chunk warning remains |
| Lint of touched presentation and extracted modules | Passed |
| Global lint | Three existing Drawio errors remain |
| Focused unit suite | 57 passed |
| Full unit suite, two workers | 1396 passed, 64 failed: the 63 baseline failures plus the event-history timeout below |
| Workbench browser matrix | 24 passed, including Compact density in Light mode |
| Additional Codex browser suite | 6 passed, 5 failed; details below |
| Whitespace/diff check | Passed |

The 240-event history test exceeded its unchanged five-second timeout during the
full run (6.5 seconds). The same assertions passed in the focused run and in an
isolated run (2.76 seconds). Its timeout and assertions were not relaxed. This
remains a full-suite validation limitation, not a passing gate.

The additional Codex suite failed two exact `box-shadow: none` expectations
because Tailwind computes a list of transparent zero shadows, two quota/account
selection scenarios that seek the account select outside its Configuration tab,
and the fixture-model option expectation in the preference scenario. A comparison
baseline for this additional suite was unavailable. These five failures remain
recorded explicitly; Codex account/model/runtime code and the existing assertions
were not changed to obtain a pass. Native activity/question, incremental guidance,
completion notification and final diff/version fixture scenarios passed.

Final review extracted the command type contract to avoid a component/search type
cycle. The editor focus policy additionally retains autofocus when its own dialog
owns the editor. Zen uses a compact exit icon with reserved toolbar space, with a
browser assertion that it cannot overlap Save. Post-review tests and gate logs
are recorded in [the machine-readable report](professional-ide-polish-validation-2026-10-16.json).

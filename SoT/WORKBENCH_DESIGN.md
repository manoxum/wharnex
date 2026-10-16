# Wharnex workbench design system

## Scope and authority

The operator requested a progressive UX redesign on 2026-10-15. This document
defines its information architecture and shared interaction rules. It extends
`UI_UX.md`; execution, authentication, IPC, terminal and data contracts are
unchanged. `TABS.md` continues to govern every tab and its resource exceptions.

## Audit and information architecture

| Responsibility | Existing owners | Presentation |
| --- | --- | --- |
| Project and repository | WorkspaceShell, WorkspaceTopbar, ProjectTabs, ProjectGitBadge | Global context; preserve project bindings and Git confirmations |
| Development | AgentProjectExplorer, EditorWorkspace, EditorSearchPalette, GitDrawer, ExecutionErrorsDrawer | Files, search, review and diagnostics near the editor |
| Intelligence | AgentWorkspace, ChatPanel, CodexPanel, AgentRuntimeDrawer, ChatManagementDrawer | Conversation in the centre; configuration separated from messages |
| Operations | ProjectTasksDrawer, OrchestratorWorkspace, EvolutionEvidenceDrawer | Running, waiting, attention and history with progressive evidence |
| Project resources | ArtifactExplorerPanel, ProjectKnowledgeDrawer, ProjectTodoPanel | Contextual collections with search, empty states and actions |
| Tools | UITestingPanel, DockerServicesPanel, DatabaseExplorerPanel | Contextual panels; preserve explicit human operations |
| Human execution | TerminalWorkspace | Persistent real Host PTYs in the bottom workbench |
| Remote surfaces | ChatGPTDesktopPane, BrowserMonitor, InspectorEngineSurface | Preserve owned mirrors, direct-human/automation separation and narrow IPC |
| Administration | ProjectSettings, appearance, language, tunnel and storage settings | Stable categories; progressive advanced settings and explicit saving |

Structural causes: navigation split across two default rails; unrelated tools
with equal emphasis; panel font/reload actions permanently competing with domain
actions; configuration controls sharing the conversation toolbar; duplicated
headers/empty states; technical queue configuration preceding useful work;
legacy cascade rules overriding new utilities; tiny independent text sizes.

The default launcher groups development, intelligence and project tools on one
left rail. The right side is auxiliary; existing customized ordering, pinning and
cross-side dragging are retained. Group separators describe consecutive groups
without silently sorting a saved user layout. Overflow scrolls inside the rail.
Editor, Agent and Orchestrator remain first-class workspaces with state preserved
when switching. Codex remains a native engine choice, never a second execution
implementation or a protocol planner.

## Foundations

- Use existing theme/accent tokens and user typography preferences. Introduce
  explicit workbench tokens for readable labels, body text, titles, control
  height, spacing, radii and motion; keep code and resource-tab typography intact.
- Surfaces progress from background, sidebar and content to elevated menus.
  Green identifies intentional primary actions. Blue identifies selected content
  tabs. Success, warning, error and information always include words or icons.
- Use the existing Icon vocabulary. Controls have accessible names, visible
  focus, disabled states and consistent target sizes.
- Shared workbench primitives own button, icon action, field, header, semantic
  badge, empty state and contextual popover appearance. New surfaces use Tailwind.
- Shared legacy element defaults still serve unmigrated modules. New primitives
  explicitly override those defaults with important utilities; this is the
  bounded shared-cascade exception in FRONTEND_STYLING §3. Dedicated legacy
  selectors are removed when their owner migrates.

### Shared scale

Typography tokens multiply by the persisted `--ui-font-scale`; they never replace
the user's font family, zoom or density preferences. The existing default scale
is 1.32. Resource tabs, Monaco, Quill and xterm retain their dedicated contracts.

| Token / dimension | Value | At default scale |
| --- | --- | --- |
| `text-whx-caption` | 8.5 px × scale | 11.2 px |
| `text-whx-label` | 9.75 px × scale | 12.9 px |
| `text-whx-body` | 10.5 px × scale | 13.9 px |
| `text-whx-title` | 11.5 px × scale | 15.2 px |
| `text-whx-heading` | 15 px × scale | 19.8 px |
| Spacing | 4, 8, 12, 16, 24, 32 px | Fixed layout rhythm |
| Control / list row / panel heading | 32 / 36 / minimum 56 px | Content may grow |
| Control / elevated surface radius | 6 / 12 px | Shared Tailwind utilities |
| Hover transition | 150 ms | Disabled with reduced motion |

Semantic colours resolve through the selected theme, including custom accents.
`whx-muted` is a surface; secondary text uses `whx-faint`. Selection in content
tabs remains blue; resource strips retain their explicit theme-accent exceptions.

## Interaction and layout

- Keep primary work visible. Panel zoom/reload live in a named options popover;
  close remains directly accessible. Preserve lazy loading and mounted drawers.
- Context popovers close on Escape, outside pointer/focus and trigger activation;
  Escape restores trigger focus. Their contents use normal keyboard navigation.
  They are nonmodal, labelled dialogs when they contain form controls.
- Layout actions toggle side/bottom panels, offer reversible concentration and
  restore defaults explicitly. Concentration must not close terminals, discard
  tabs or overwrite the saved working layout. Resizing remains project-scoped.
- Narrow layouts prioritize the central activity and use overflow inside tools;
  saved panel geometry must not be destroyed by a temporary viewport change.
- Composer engine and safety permissions remain visible. Model and reasoning
  remain immediately usable; automation budget and transport configuration may
  use an explicit settings disclosure. No account state is inferred from an
  absent or loading status response.
- Task operational settings are disclosures. Empty queues are explicit empty
  states, never loading indicators. Existing task evidence and retry actions stay.
- The bottom workbench groups Terminal, Problems and Execution Output using the
  shared content tabs. Terminal instance resource tabs keep their original chrome.
  Tool selection and collapse never unmount the real terminal. Explicit human
  terminal activation/run requests reveal that tool; switching tools sends no
  input. Output merges durable execution history with live events, including when
  the snapshot no longer contains the last execution. Selection is project-scoped.
- Git review gives the code the largest region, with selectable files and real
  inline/side-by-side Monaco comparisons. Confirmation remains a separate action.
- Simple confirmations use existing small application dialogs; complex review
  and settings use resizable/maximizable workspaces, never fake modal controls.
- Motion is short and respects reduced-motion preferences. Async progress is
  driven by real requests; stale useful content stays visible during refresh.
- The standalone browser monitor uses the same theme and controls. It collapses
  contextual columns at narrow widths and offers reversible browser focus, while
  retaining the selected native view. The location is an honest read-only label;
  no general remote navigation/reload IPC is introduced. Policies remain beside
  the native view, including their inline confirmations. Diagnostics and the
  state legend are progressive details, never extra permanent monitoring bars.
- Appearance, language, composer, workspace, limits and local data share the
  settings page/group pattern. Connection pages share their introduction, catalog
  action, saving and restart status. Existing credential/provider editors retain
  their scoped legacy form contract during the incremental migration. Loading
  failures in language/provider pages end progress and offer explicit retry.

## Migration and validation

### Product polish: spatial priority

The primary workspace owns the remaining space; supporting tools keep their
preferred sizes only while that leaves a useful primary region. Explorer,
review and operational tools have separate readable bounds. Temporary viewport
constraints never overwrite preferred sizes. If both tools cannot fit beside
the primary workspace, the right tool becomes an overlay with an explicit close
action. This is a presentation change, not a panel lifecycle change.
A single supporting tool also overlays when its readable minimum would consume
the primary reserve in a compact window.
Explicit resizing gives the adjusted side priority over the other supporting
tool's slack. Remember that priority per project so reopening restores the same
manual layout; viewport-only projections still do not write preferred widths.

The bottom utility strip remains available when its content is collapsed.
An empty Problems surface restored without an explicit expansion uses only
the strip. Clicking a utility tab or resizing is explicit expansion and is
remembered per project; later empty results must not collapse that decision.
Unknown/failed diagnostics are never presented as zero. Maximize/restore is
temporary and must not replace the saved manual height. Hidden terminal instances
remain mounted. Separators support keyboard adjustment and pointer cancellation.

Concentration is temporary, applies to the current main activity, and leaves
panel selection, geometry, drafts and sessions untouched. Escape exits it only
when a higher priority dialog/popover has not consumed the key.

Semantic surfaces resolve through the current theme: app, workspace, side,
raised, control, hover, selection and popover. Brand accent identifies intent;
success, running, warning, error and selection have independent semantic tokens.
State must remain readable through text or symbols as well as colour.

Persisted keys, archived conversations, Git/executor APIs and native permissions
are compatibility boundaries. Existing preferences are loaded without reset.
Only the explicit restore command replaces launcher/layout customization.

The redesign is incremental by owner, with focused interaction tests, frontend
typecheck/lint/test/build and browser checks at narrow/wide widths in light/dark
themes and scaled typography. Failures must be compared with the initial dirty
working tree; pre-existing work is preserved. Refactoring follows extract-on-touch,
the 200-line limit and named domain boundaries.

### Professional IDE polish: tool surfaces and distraction-free presentation

Supporting tool windows reuse the existing dock/width owners. Their common
options menu exposes temporary maximize/restore, existing left/right move and
stripe pin operations when the owner supports them. Maximization covers only
the primary row, leaves resources mounted, and never writes preferred width.
Escape restores a maximized tool after nested dialogs/menus have consumed it;
opening another tool retires temporary maximization.

Distraction-free (Zen) is a temporary presentation state selected through the
command palette. It hides supporting tools, utility chrome, the top toolbar and
status bar without changing persisted panel selections or dimensions. An
explicit exit control and Escape restore the preceding presentation. Ordinary
focus mode remains available independently. Deferred Monaco mount/reveal work
must not take focus away from an already active external dialog or menu.

Search Everywhere keeps real commands and project file results in the existing
palette. Matching covers names, paths and action descriptions, is insensitive
to diacritics, and requires every query term. Initial rendering is bounded;
additional matching results remain reachable through an explicit action. File
loading or failure does not block the command catalogue. No discovery result
executes an operation until explicitly selected.

UI testing uses compact environment groups and test rows, icon/text status,
recorded completed-run durations and expandable strategies. Rerun failed uses
the existing run operation with the exact failed IDs and existing configuration
checks. UI-only work does not invent Debug or Stop operations absent from the
runtime contract. Evolution events retain original order, filtering, selection,
bounded batches and lazy payload expansion in a flat technical timeline.

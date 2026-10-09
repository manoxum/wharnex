# Canonical tab migration

The binding contract is `SoT/TABS.md`. Desktop content and resource strips share
`components/presentation/tabs`; the paired webapp owns its independent Chat strip.
Standard tabs use a blue theme token regardless of the product accent. By explicit
operator request, terminal instances, open chat conversations and linked projects
retain their original resource chrome through named shared appearances. Their
titles stay visible with ellipsis and horizontal overflow.
Only the Agent/Chat surface strip stays icon-only. Chat selection and remembered
Inspector selection are exclusive in single-pane mode.

## Refactoring bounds

The maintained concern is tab presentation, adaptive density, accessible keyboard
navigation and selection. Shared primitives own those responsibilities; extracted
panel/resource strips retain their existing callbacks, resource lifecycle and
secondary actions. Superseded tab selectors and the unused project pulse keyframe
were removed. Existing wire/storage identifiers are unchanged.

New implementation and focused tests are under 200 lines and placed in named
owning domains. Tab scenarios were extracted from AgentWorkspace, WorkspaceShell
and GitDrawer test files. The remaining legacy responsibilities are follow-up debt:

- `AgentWorkspace` and `WorkspaceShell`: overall pane/window orchestration and
  their unrelated legacy scenarios.
- `GitDrawer`: Git action workflows, modal state and unrelated action scenarios.
- `EditorWorkspace` and `Inspector`: document lifecycle and inspector composition.
- `DockerServicesPanel`: service operations and detailed service rendering.
- `AgentRuntimeDrawer`: runtime diagnostics and non-tab policy/action scenarios.
- `ArtifactExplorerPanel` and `ComposerAttachmentPanel`: artifact browsing and
  attachment operations.
- `ChatAgentTasksDrawer`, `ProjectTasksDrawer`, `ProjectTodoPanel`: task operations
  and task/detail rendering.

Custom linked-project composer pulse keyframes remain domain-owned CSS because
stock Tailwind animations cannot interpolate the per-project hue and shadows.
All other restored chrome uses Tailwind.

Existing secondary editor/terminal actions retain their domain CSS. Their tab
strip sizing, colors, typography and selection now use Tailwind; changing those
unrelated secondary controls is outside this migration.

## Verification

Focused unit coverage checks shared adoption, fit-based density and widening,
keyboard navigation, badges, resource actions and exclusive icon-only Chat
selection. `e2e/tabs/workbench.spec.ts` checks Light/Dark, a non-blue accent,
container resizing, UI font scaling, UI Lab/browser strips and resource headers.
The fixture does not start a host PTY or mutate a project.

Broad repository failures must be compared with the unchanged baseline. Existing
failures remain visible; tab migration must not relax unrelated assertions or
repair unrelated work to make a gate appear green.

Validated on 2026-10-06:

- Desktop and webapp typechecks and production builds passed.
- Shared primitive/adoption tests: 8 passed; exclusive Chat strip: 1 passed.
- Browser tab verification: 2 passed; webapp suite: 13 passed.
- Desktop complete suite: 1,138 passed, 63 failed. 61 failed assertions also
  reproduce in the unchanged baseline (with relocated scenario titles normalized).
  The other two, FIFO discovery and Git quick-commit, pass when rerun separately
  in both versions; their full-suite failures are timing-sensitive.
- Desktop lint reports the same three errors in the unchanged baseline:
  unused parameters in `DrawioPreview.test.tsx` and a control-character regex
  in `drawioModel.ts`. No tab lint errors were reported.
- Repository structural gates remain blocked outside this change:
  `desktop/agent/scheduling/queue/scheduler/settlement.test.mjs` exceeds 200 lines,
  and `backend/internal/app` exceeds the domain file count. Tab files satisfy
  the size and domain limits.
- `git diff --check` passed.

## Restored resource exceptions (2026-10-06)

Terminal instance tabs use their original 34px height, status/title/close layout
and theme-accent underline. Conversation tabs show the title and trailing link
dot, original active fill/border and full switcher height. Linked projects use
30px rounded buttons, stable project hues, active chevron and inset unlink.
These three strips retain labels with ellipsis and horizontal overflow, rather
than collapsing to generic icons or filling spare width.

`AGENTS.md`, `SoT/TABS.md` and `SoT/UI_UX.md` explicitly bind agents to these
exceptions. Shared tab semantics, keyboard behavior and resource lifecycle are
preserved. The shared adoption gate restricts each appearance to its authorized
owner. Refactoring is bounded to resource chrome, its shared presentation variants
and superseded legacy selectors; all new files stay below the 200-line cap.

Restoration validation: 25 focused tests passed (including shell composer
integration); resource/splash browser scenarios passed in Light/Dark, with compact
density and reduced motion; the standard-tab browser scenarios also passed.
The restoration's ESLint scope is clean. The full frontend lint still reports the
three earlier Drawio issues. The broad suite remains blocked by previously
recorded assertions and timing failures; 13 additional full-run failures passed
when isolated without changing their timeouts or assertions.

The operator also requested definitive fixed widths: all terminal, conversation
and linked-project tabs are exactly 160px, including compact/narrow layouts.
Shared `data-resource-tab` chrome owns this width. Long titles use ellipsis and
strips scroll horizontally rather than resizing tabs.


Fixed-width validation: Light/Dark browser resource scenarios assert exactly
160px for chat, terminal and project tabs, including compact UI density and narrow
containers. All four standard/resource tab browser scenarios pass; the 13 shared
feature/integration tests, scoped ESLint and frontend typecheck/build pass.
The unrelated terminal canvas assertion still fails against its pre-existing
color expectation; it was preserved. Existing global lint/suite limitations above
remain visible. Refactoring is bounded to the shared width contract, resource
wrappers and their regression coverage; no resource lifecycle behavior changes.


## Resource width correction (2026-10-06)

The operator corrected the linked-project requirement: recover its main-branch
natural-width chrome and display the complete project name. The previous 160px
project requirement above is superseded. The main-branch 150px title cap is also
removed so long names remain complete; the strip keeps its width limit and
horizontal scrolling. Project marks, hue, active menu, unlink and attention
remain intact through the shared Tailwind project appearance.

Terminal and conversation tabs keep 160px widths. Editor documents now use the
same fixed resource width and ellipsis through the named `document` appearance,
with file glyphs, Git/dirty indicators, separate close actions and the existing
blue selected underline. Panel tab density and appearance remain unchanged.
The refactoring pass shares the editor/panel visual chrome while keeping their
layout contracts separate; all touched implementation and test files remain
under 200 lines.

Restoration checks: 22 focused tests and eight Light/Dark browser scenarios pass,
including the original 0.9s pulse, peak glow, 160ms transitions, reduced-motion
highlight, full project names, fixed document widths and keyboard navigation.
Both theme screenshots were visually inspected. Scoped ESLint is clean.

Frontend typecheck and the production build pass after the final refactoring
pass. Global ESLint still reports three pre-existing Draw.io errors. The
repository file-size gate reports one unrelated pre-existing scheduler test
over the cap (`settlement.test.mjs`, 223 lines); every implementation and test file touched for this
resource-width correction is below 200 lines.

The full post-change frontend suite completed with 45 failing files / 69 failing
cases. Sixty-eight of those cases also failed in the pre-change run (which had
119 failures). The remaining case, EditorWorkspace split/detach navigation,
reported duplicate mounted editors during the broad run; all nine tests in
that integration file pass when rerun unchanged in isolation. Assertions and
timeouts were preserved. Together with the 22 focused checks, 31 related tests
pass. No unrelated global failures were repaired in this change.


## Full resource restoration to main (2026-10-06)

The operator subsequently requested all four resource strips as implemented on
`main` (`e8dbf4bb`). This supersedes the fixed 160px requirements and document
blue selection above. The shared resource appearances retain natural widths,
original theme-accent selection and horizontal scrolling: terminals are bounded
at 138–240px (96px minimum in compact density), conversations at 210px, and
documents at 230px with 150px ellipsized titles. Linked projects retain complete
names. Documents restore 36px chrome, their original 10px monospace typography,
unboxed Git/dirty indicators and restrained close controls. The fixed document
font is the named visual-parity exception recorded in FRONTEND_STYLING.md.

The implementation retains shared keyboard navigation and separate resource
actions. There is no storage, transport or resource-lifecycle migration. The
refactoring pass separates strip appearance from density/navigation, and keeps
document chrome in the Editor domain; no legacy CSS selectors are restored.

Validation of the full restoration: 42 related tests pass; the preserved terminal
canvas color assertion still fails as it did before this change. All 10 browser
scenarios pass in Light/Dark, including direct document dimension/palette parity
against frozen `main` chrome, narrow strips, keyboard selection and project
attention. Both final theme screenshots were visually inspected. Frontend
typecheck, scoped ESLint and the final production build pass. Global lint retains
the three pre-existing Draw.io errors. The repository size gate retains the
unrelated 223-line scheduler test; the domain-layout gate retains the overfull
backend app and UI-testing HTTP directories. No touched implementation or test
file exceeds 200 lines.

The broad frontend run reports 68 failures versus 76 in the initial run. Three
new source-inspection failures came from moving strip chrome into its named
module; inspection now follows that composed module and those assertions pass
in focused reruns. The fourth newly reported case, project execution concurrency,
also passes unchanged in isolation. The remaining failures reproduce baseline
expectations or timing issues outside this restoration; no assertions/timeouts
were weakened.


## Content-only widths and local runtime correction (2026-10-06)

The operator clarified that every resource tab must occupy only its content's
width. Terminal minimum widths of 138/96px are superseded; all four resource
strips explicitly keep content widths without flex growth or shrinking. Existing
maximum title bounds and horizontal overflow remain. A browser regression first
failed at 138px and passes after removing that artificial minimum.

The project animation wiring and 0.9s hue/glow effect already match `main`. A new
browser scenario exercises the real WorkspaceShell with its owned iframe's input
messages, confirms the animation's peak glow, refresh and 1600ms idle expiry.
All 12 browser scenarios pass. The running Compose frontend was still serving
a different bundle from the local build. The corrected frontend image was built
and activated with `scripts/stack.sh activate-services frontend`; frontend and
gateway are healthy. The served CSS contains the project pulse and the updated resource tab sizing. Reload the interface to load the updated bundle. The 23 focused
tests pass; scoped lint is clean.

Final correction gates: host typecheck and production build pass, the Docker
frontend build passes, scoped ESLint passes, and all 23 focused tests plus all
12 browser scenarios pass. The full frontend suite reports 63 failing cases
versus 68 before this correction; global lint retains the same three Draw.io
errors. No unrelated assertion was relaxed.

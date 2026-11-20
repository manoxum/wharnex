# Interface English pass — 2026-10-16

## Changes

Authored interface copy now uses the existing locale preference and catalog in:

- TODO cards, actions, composer, counters and deletion confirmation.
- Task overview, source filters, task tabs and execution queue controls.
- Workspace, bundle limits, context, data/storage settings and loading states.
- Project linking, active tunnel controls and pairing.
- Chat context/reasoning/automation/transport controls and tooltips.
- Chat binding/recovery, saved/archived chat management and preview actions.
- Codex engine, permission, model and effort controls.

English options retain their original protocol values. Safety descriptions still
identify Protected verification, eligible automatic approvals, explicit Auto
Evolution restart confirmation and direct computer access. Attention colouring
uses the metric's stable icon identifier rather than its translated label.

Task text, classification analysis, pre-plans, filenames, paths, user chat titles,
provider model names and backend errors remain original evidence. Local authored
fallback errors and confirmation templates are localized with single-pass
parameter interpolation. Dates use the interface locale in maintained surfaces.
The reset token `APAGAR WHARNEX` remains unchanged because it is required by the
existing frontend, backend and Desktop deletion contract; its English label
instructs the user to type that exact token.

The existing device language preference remains `system | en | pt | fr`.
English selection persists and changes labels without remounting live state.
System detection remains available. No deployment or service restart was run.

## Refactoring and styling scope

The maintained TODO-card presentation and classification labels were extracted
from the oversized ProjectTodoPanel into its presentation domain. The parent is
now 178 lines; the extracted component and tests are below 200 lines. New files
use named domains and narrow entry points.

This is a localization-only styling exception: extracted TODO markup retains
its existing selectors and layout, and existing components retain their styling.
No CSS rules or new style surfaces are introduced in this pass. Translation
resource files are exempt from the implementation line cap under CODE_QUALITY
§1; the task/settings catalog is the only new resource over 200 lines.

## Verification

All tooling ran in isolated containers with networking disabled.

- TypeScript: passed after final refactoring.
- Focused localization, task presentation/operations and chat controls: 51/51 passed.
- Chromium: 8/8 passed, including cancellation and completion of TODO deletion,
  language saving/reload, preserving composer state, document state, popup bounds,
  light/dark themes and normal/compact density.
- Lint: the same three prior errors in DrawioPreview.test.tsx and drawioModel.ts;
  no additional errors.
- New-file/domain structure: 70 accumulated new source/test files, no violations.
- Full-suite and final-build results are recorded below when completed.

## Remaining coverage

This does not claim complete application localization. Legacy parent panels,
advanced connection settings, execution/inspector views and backend-authored
messages still contain Portuguese. French uses the existing English fallback in
localized surfaces. No arbitrary user text or remote output is auto-translated.

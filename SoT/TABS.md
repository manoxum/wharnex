# Tabs SoT

This is normative for all Wharnex tabs, including Desktop/local panels and the
independent paired webapp when it exposes tabs. Version Control is the visual
reference. `AGENTS.md` and `SoT/UI_UX.md` require agents to apply this contract
whenever creating or maintaining a tab surface.

## Appearance

- Use flat, neutral, single-row workbench chrome. Each tab MUST have a meaningful
  icon and label; a UI badge MUST be present when a count or concise status applies.
  Zero is a valid count. Inactive tabs use muted text; hover and focus remain clear.
- Except for the resource exceptions below, the selected tab MUST show a 2px blue bottom border through the theme token
  `--theme-tab-active`, independent of a user-selected non-blue product accent.
  Theme tokens govern backgrounds, text and UI-scaled typography.
- Outside the explicit resource exceptions, pill buttons, cards, rounded segmented controls and separate active-color
  grammars MUST NOT be introduced for tabs.

## Adaptation to available space

- Measure the owning strip and its intrinsic content, not the viewport. All tabs
  in one strip MUST progress together through: icon + label + badge; icon + badge;
  icon only. Badges are omitted when inapplicable.
- Labels disappear only when the full content cannot fit; badges disappear only
  when icon + badge cannot fit. Resizing, changed counts, new tabs and UI font
  scaling MUST recompute density and MUST restore content when space returns.
- If even icons cannot fit, retain horizontal scrolling and keyboard reachability;
  never wrap, overlap, clip away a tab or shrink its icon to conceal overflow.
- The Agent surface density exception is the Agent/Chat surface strip **Chat, Ficheiros,
  Plano, Execução, Engine**: it MUST remain icon-only at every width (`iconsOnly`).
  Its alert state remains visible through icon emphasis and accessible tooltips.
  Conversation/resource titles follow their separate exception below.
- Collapsing visual content MUST preserve full accessible names, tooltips and the
  current selection. Distinguish repeated resource icons with the resource title.

## Explicit resource exceptions

The operator requested restoration of the original resource chrome on 2026-10-06.
The following resource strips have named exceptions to the standard rules:

- **Terminal instances** retain 34px chrome, connection status, title, close action,
  restrained theme-accent selection and horizontal overflow.
  Compact UI density retains its original 24px tab height.
- **Open chat conversations** retain their title and trailing ChatGPT-link dot,
  original theme-accent selection/background, separate save/archive actions and
  horizontal overflow. Tabs occupy the full Agent switcher height; standalone
  chat tabs retain 31px chrome. No generic chat icon or UI badge is added.
- **Linked projects** retain their 30px rounded project buttons, stable project
  hue, project mark, active-menu chevron, inset unlink action and composer attention.
  Their strip retains the original width limit and horizontal overflow. Following
  the operator correction on 2026-10-06, restore the main-branch natural tab
  width and show the complete project name without ellipsis or a title-width cap.

- **Open editor documents** restore main-branch 36px chrome, file glyphs, unboxed
  Git/dirty state, restrained close actions and theme-accent selected treatment.
  Their natural width is bounded at 230px, with a 150px ellipsized title.

Following the operator's 2026-10-06 request to restore all four resource strips
from `main`, fixed 160px sizing is superseded. Terminal tabs use only the width their content needs, with a 240px maximum
and no artificial minimum, in every UI density; conversation groups
have a 210px maximum with a 182px maximum selection control. Document tabs have
a 230px maximum. Linked project names stay complete without a title-width cap.
These limits do not stretch tabs to fill spare space; overflow scrolls horizontally.

Names remain visible with full accessible titles and ellipsis where bounded.
Resource strips MUST NOT collapse to generic icons. Preserve the main-branch
appearances through the shared primitives' named `terminal`, `conversation`,
`project` and `document` appearances, including original theme-accent selection.
Other panels and the icon-only Chat/Ficheiros/Plano/Execução/Engine strip retain
their standard contracts.

## Behavior and implementation

- Desktop code MUST reuse `components/presentation/tabs` (`WorkbenchTabs`, or
  `TabBar` + `TabButton` for resource chrome). The webapp MUST own an equivalent
  local implementation when needed; it remains an independently built service.
  Agents MUST NOT fork CSS, sizing logic or keyboard behavior per panel. The named
  resource appearances above are shared exceptions, not new panel variants.
- Use `tablist`, `tab`, `aria-selected`, a single selected tab stop and visible
  keyboard focus. Left/Right wrap through enabled tabs; Home/End select the first
  and last. Disabled tabs are skipped. Preserve existing panel IDs/ARIA links.
- Resource tabs retain explicit close/save/rename, drag, dirty state, overflow,
  persistence and detach behavior. Resource actions MUST remain separate controls;
  navigation MUST NOT trigger those actions or tear down inactive resources.
- A content strip MUST mark exactly one active tab. In single-pane Agent mode,
  choosing Chat MUST clear the visual selection of Ficheiros/Plano/Execução/Engine;
  the remembered Inspector tab is retained only for returning to that surface.
- Tool launchers, list selections, command buttons and view-option toggles that do
  not represent mutually exclusive content panels are not tabs. Agent surface
  tabs retain the alert/activity behavior specified in `UI_UX.md`.
- Changes MUST migrate touched tab chrome to Tailwind and delete superseded legacy
  selectors, with extraction/domain limits enforced by the quality normatives.

## Verification

Automated tests MUST cover the three densities and widening recovery, optional
and zero badges, accessible labels, selected blue underline, keyboard navigation,
selection callbacks, disabled tabs and resource actions. Browser verification MUST
exercise wide/narrow owning containers in Light/Dark and non-default UI scale.
New tab surfaces MUST be included in the shared-implementation coverage gate.

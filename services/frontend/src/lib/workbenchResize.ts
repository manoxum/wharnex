// Shared geometry for the two independent side-panel splitters.
//
// The workbench row is `[rail] [left drawer] [splitter] [centre] [splitter]
// [right drawer] [rail]`, and each side used to compute its drag ceiling from
// its own partial picture of that row: the left splitter measured the opposite
// drawer only by `.workspace-side-drawer-*` (so it never saw the Database
// panel, which is a different component with a different class), and the right
// splitter ignored the left drawer entirely. Whenever the two disagreed the
// row overflowed, and because the centre is `flex: 1` - flex-basis 0, which
// gives it no share of the shrinking - every pixel of that overflow came out
// of the *other* drawer. Dragging one panel visibly pushed the panel on the
// far side instead of resizing the centre.
//
// Both splitters now measure the same way: everything in the row except the
// centre and the panel being dragged.

// What a drag must leave the centre panel. Small on purpose: the centre has no
// width floor of its own any more (see styles.css), so this only keeps it from
// collapsing somewhere the operator cannot grab it again.
export const WORKBENCH_CENTRE_MIN_PX = 240

const CENTRE_SELECTOR = '.workspace-mode-stack'

/**
 * The widest `panel` may become without pushing the centre below its reserve.
 *
 * Measures the live row rather than assuming which rails, splitters and
 * drawers are mounted, so a panel that only one of the two splitters knows
 * about is still counted by both.
 */
export function drawerResizeCeiling(body: HTMLElement, panel: HTMLElement, minimum: number, centreMin = WORKBENCH_CENTRE_MIN_PX) {
  const row = (body.querySelector('.workspace-main-row') as HTMLElement | null) || body
  const available = row.getBoundingClientRect().width
  if (!available) return Math.max(minimum, panel.getBoundingClientRect().width)
  let reserved = 0
  for (const child of Array.from(row.children)) {
    if (child === panel || !(child instanceof HTMLElement)) continue
    if (child.matches(CENTRE_SELECTOR) || child.contains(panel)) continue
    reserved += child.getBoundingClientRect().width
  }
  return Math.max(minimum, available - reserved - centreMin)
}

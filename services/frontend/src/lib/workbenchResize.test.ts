import { describe, expect, it } from 'vitest'
import { drawerResizeCeiling, WORKBENCH_CENTRE_MIN_PX } from './workbenchResize'

// jsdom reports every rect as zero, so widths are stubbed per element.
function row(widths: { cls: string; width: number }[], available: number) {
  const body = document.createElement('div')
  body.className = 'workspace-body'
  const main = document.createElement('div')
  main.className = 'workspace-main-row'
  Object.defineProperty(main, 'getBoundingClientRect', { value: () => ({ width: available }) })
  for (const { cls, width } of widths) {
    const child = document.createElement('div')
    child.className = cls
    Object.defineProperty(child, 'getBoundingClientRect', { value: () => ({ width }) })
    main.appendChild(child)
  }
  body.appendChild(main)
  return { body, main }
}

describe('drawerResizeCeiling', () => {
  // The defect: each splitter derived its ceiling from a partial picture of
  // the row. The left one measured the opposite drawer only by
  // `.workspace-side-drawer-*`, so it never saw the Database panel; the right
  // one ignored the left drawer entirely. Whenever they disagreed the row
  // overflowed, and because the centre is flex-basis 0 it takes no share of
  // the shrinking - so the overflow came out of the *other* drawer, which read
  // as one panel pushing the panel on the far side.
  it('counts every sibling in the row except the centre and the dragged panel', () => {
    const { body, main } = row([
      { cls: 'agent-activity-bar', width: 44 },
      { cls: 'agent-drawer workspace-side-drawer workspace-side-drawer-left', width: 400 },
      { cls: 'agent-drawer-splitter', width: 6 },
      { cls: 'workspace-mode-stack', width: 900 },
      { cls: 'workspace-right-splitter', width: 6 },
      { cls: 'workspace-right-drawer', width: 500 },
      { cls: 'workspace-right-rail', width: 44 },
    ], 1900)
    const left = main.querySelector('.workspace-side-drawer-left') as HTMLElement
    // Everything except the centre and the dragged left drawer: 44+6+6+500+44.
    expect(drawerResizeCeiling(body, left, 240)).toBe(1900 - 600 - WORKBENCH_CENTRE_MIN_PX)

    const right = main.querySelector('.workspace-right-drawer') as HTMLElement
    // The Database splitter now counts the left drawer, which it never did.
    expect(drawerResizeCeiling(body, right, 360)).toBe(1900 - (44 + 400 + 6 + 6 + 44) - WORKBENCH_CENTRE_MIN_PX)
  })

  it('never returns less than the panel minimum', () => {
    const { body, main } = row([
      { cls: 'workspace-side-drawer-left', width: 400 },
      { cls: 'workspace-mode-stack', width: 100 },
      { cls: 'workspace-right-drawer', width: 900 },
    ], 1000)
    const left = main.querySelector('.workspace-side-drawer-left') as HTMLElement
    expect(drawerResizeCeiling(body, left, 240)).toBe(240)
  })

  it('leaves the centre exactly its reserve and no more', () => {
    const { body, main } = row([
      { cls: 'workspace-side-drawer-left', width: 300 },
      { cls: 'workspace-mode-stack', width: 700 },
    ], 1000)
    const left = main.querySelector('.workspace-side-drawer-left') as HTMLElement
    // The centre must be free to shrink all the way down to the reserve, which
    // is far below the half-width it used to be pinned at.
    expect(drawerResizeCeiling(body, left, 240)).toBe(1000 - WORKBENCH_CENTRE_MIN_PX)
    expect(WORKBENCH_CENTRE_MIN_PX).toBeLessThan(500)
  })
})

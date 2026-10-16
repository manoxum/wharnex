import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'
import { drawerResizeCeiling } from '../../../../lib/workspace/layout/workbenchResize'
import { primaryWorkspaceReserve, supportingPanelBounds } from './panelAllocation'
import { rememberPanelPriority } from './panelPriority'

export function useSupportingResize(root: RefObject<HTMLElement | null>, side: 'left' | 'right', tool: Drawer, projectPath: string, onWidth: (width: number) => void) {
  const cleanup = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => cleanup.current?.(), [tool, projectPath])
  function limits() {
    const panel = root.current
    const body = panel?.closest<HTMLElement>('.workspace-body')
    const bounds = supportingPanelBounds(tool)
    const width = panel?.closest('.workspace-main-row')?.getBoundingClientRect().width || window.innerWidth
    let ceiling = panel && body ? drawerResizeCeiling(body, panel, bounds.min, primaryWorkspaceReserve(width)) : bounds.max
    const sibling = panel?.parentElement?.querySelector<HTMLElement>(`.workspace-side-drawer-${side === 'left' ? 'right' : 'left'}:not([hidden])`)
    if (sibling && getComputedStyle(sibling).position !== 'absolute') ceiling += Math.max(0, sibling.getBoundingClientRect().width - supportingPanelBounds(sibling.dataset.panelTool as Drawer).min)
    return { min: bounds.min, max: Math.min(bounds.max, ceiling) }
  }
  function update(width: number) {
    const { min, max } = limits()
    const row = root.current?.closest<HTMLElement>('.workspace-main-row')
    if (row) rememberPanelPriority(row, projectPath, side)
    onWidth(Math.round(Math.max(min, Math.min(max, width))))
  }
  function begin(event: PointerEvent<HTMLButtonElement>) {
    const panel = root.current
    if (!panel || event.button !== 0) return
    event.preventDefault(); event.currentTarget.focus(); cleanup.current?.()
    const startX = event.clientX, startWidth = panel.getBoundingClientRect().width
    const previous = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect }
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    const move = (pointer: globalThis.PointerEvent) => update(startWidth + (pointer.clientX - startX) * (side === 'left' ? 1 : -1))
    const finish = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish)
      document.body.style.cursor = previous.cursor; document.body.style.userSelect = previous.userSelect; cleanup.current = undefined
    }
    cleanup.current = finish
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish)
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const { min, max } = limits()
    const delta = (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1)
    update(event.key === 'Home' ? min : event.key === 'End' ? max : (root.current?.getBoundingClientRect().width || min) + delta)
  }
  return { begin, keyboard, minimum: supportingPanelBounds(tool).min, maximum: supportingPanelBounds(tool).max }
}

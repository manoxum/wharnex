import { useLayoutEffect, useRef, useState } from 'react'
import type { Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'
import { allocateSupportingPanels, primaryWorkspaceReserve, supportingPanelBounds } from './panelAllocation'
import { panelPriority } from './panelPriority'

export function useSupportingPanel(side: 'left' | 'right', tool: Drawer, preferred: number, projectPath: string) {
  const root = useRef<HTMLElement>(null)
  const [geometry, setGeometry] = useState({ width: preferred, overlay: false })
  useLayoutEffect(() => {
    const panel = root.current
    const row = panel?.closest<HTMLElement>('.workspace-main-row')
    if (!panel || !row) return
    const measure = () => {
      const width = row.clientWidth
      if (!width) return
      const panels = Array.from(row.querySelectorAll<HTMLElement>(':scope > .workspace-side-drawer:not([hidden])'))
      const read = (candidate?: HTMLElement) => candidate ? { tool: candidate.dataset.panelTool as Drawer, preferred: Number(candidate.dataset.panelPreferredWidth) || 320 } : undefined
      const inline = panels.filter((candidate) => !(candidate.dataset.panelSide === 'right' ? width < 1000 : width < 700))
      let chrome = 0
      for (const child of Array.from(row.children)) {
        if (!(child instanceof HTMLElement) || child.matches('.workspace-center-column, .workspace-mode-stack, .workspace-side-drawer, .workspace-side-splitter')) continue
        const style = getComputedStyle(child)
        if (style.position !== 'absolute' && style.display !== 'none') chrome += child.getBoundingClientRect().width
      }
      // Count eligible dividers before deciding on an overlay. Measuring a
      // currently hidden divider otherwise makes the threshold oscillate.
      chrome += inline.length * 6
      const left = read(inline.find((item) => item.dataset.panelSide === 'left'))
      const right = read(inline.find((item) => item.dataset.panelSide === 'right'))
      const leftOverlay = Boolean(left && supportingPanelBounds(left.tool).min > width - chrome - primaryWorkspaceReserve(width))
      const allocation = allocateSupportingPanels(width, chrome, leftOverlay ? undefined : left, right, panelPriority(row, projectPath))
      const overlay = side === 'right' ? width < 1000 || allocation.rightOverlay : width < 700 || leftOverlay
      const bounds = supportingPanelBounds(tool)
      const projected = overlay ? Math.min(Math.max(preferred, bounds.min), bounds.max, width - 88) : allocation[side]
      const next = { width: Math.max(0, projected), overlay }
      setGeometry((current) => current.width === next.width && current.overlay === next.overlay ? current : next)
    }
    measure()
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    resize?.observe(row)
    const mutation = new MutationObserver((records) => {
      if (records.some(({ target }) => target === row || target instanceof HTMLElement && target.matches('.workspace-side-drawer'))) measure()
    })
    mutation.observe(row, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-panel-tool', 'data-panel-preferred-width', 'data-panel-priority'] })
    window.addEventListener('resize', measure)
    return () => { resize?.disconnect(); mutation.disconnect(); window.removeEventListener('resize', measure) }
  }, [side, tool, preferred, projectPath])
  return { root, ...geometry }
}

import { useEffect, useState, type RefObject } from 'react'
import type { Drawer } from '../../../../lib/workspace/layout/workspaceDrawer'

/** Presentation only: the owning tool and its persistent dimensions stay intact. */
export function useToolWindowMaximize(root: RefObject<HTMLElement | null>, tool: Drawer, project: string) {
  const [target, setTarget] = useState('')
  const identity = `${project}\n${tool}`
  useEffect(() => setTarget(''), [identity])
  const maximized = Boolean(tool && target === identity)
  useEffect(() => {
    if (!maximized) return
    const row = root.current?.closest<HTMLElement>('.workspace-main-row')
    const previous = document.activeElement
    const exit = (event: KeyboardEvent) => {
      if (root.current && getComputedStyle(root.current).display === 'none') return
      if (event.key !== 'Escape' || event.defaultPrevented || event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]')) return
      event.preventDefault(); event.stopPropagation(); setTarget('')
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
    const observer = new MutationObserver((records) => {
      if (records.some(({ target }) => target instanceof HTMLElement && target !== root.current && target.matches('.workspace-side-drawer:not([hidden])'))) setTarget('')
    })
    if (row) observer.observe(row, { subtree: true, attributes: true, attributeFilter: ['hidden'] })
    row?.setAttribute('data-tool-maximized', tool)
    window.addEventListener('keydown', exit)
    return () => { observer.disconnect(); row?.removeAttribute('data-tool-maximized'); window.removeEventListener('keydown', exit) }
  }, [maximized, root, tool])
  return { maximized, toggle: () => setTarget((current) => current === identity ? '' : identity) }
}

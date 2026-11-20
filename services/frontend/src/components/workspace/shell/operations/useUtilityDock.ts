import { useLayoutEffect, useRef, useState, type RefObject, type PointerEvent } from 'react'
import type { OperationalTab } from './useOperationalTab'
type Dock = 'bottom' | 'right'
type Geometry = { dock: Dock; width: number }
function load(key: string): Geometry {
  try { const value = JSON.parse(localStorage.getItem(key) || '{}'); return { dock: value.dock === 'right' ? 'right' : 'bottom', width: Math.max(240, Math.min(640, Number(value.width) || 360)) } } catch { return { dock: 'bottom', width: 360 } }
}
export function useUtilityDock(root: RefObject<HTMLElement | null>, project: string, tool: OperationalTab, visible: boolean) {
  const key = `wharnex.utility.geometry.v1:${project}:${tool}`
  const [availableWidth, setAvailableWidth] = useState(window.innerWidth)
  const [geometry, setGeometry] = useState(() => load(key))
  useLayoutEffect(() => {
    const parent = root.current?.parentElement
    if (!parent) return
    const measure = () => setAvailableWidth(parent.clientWidth || window.innerWidth)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(parent)
    return () => observer?.disconnect()
  }, [root])
  const dock = availableWidth >= 640 ? geometry.dock : 'bottom'
  useLayoutEffect(() => setGeometry(load(key)), [key])
  useLayoutEffect(() => {
    const parent = root.current?.parentElement
    if (!parent || !visible || dock !== 'right') return
    const previous = { display: parent.style.display, columns: parent.style.gridTemplateColumns, rows: parent.style.gridTemplateRows }
    parent.style.display = 'grid'
    parent.style.gridTemplateRows = 'minmax(0, 1fr)'
    parent.style.gridTemplateColumns = `minmax(0, 1fr) minmax(0, min(${geometry.width}px, 48%))`
    return () => { parent.style.display = previous.display; parent.style.gridTemplateColumns = previous.columns; parent.style.gridTemplateRows = previous.rows }
  }, [root, visible, geometry, dock])
  function update(next: Geometry) { setGeometry(next); try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* best effort */ } }
  const finishDrag = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => () => finishDrag.current?.(), [])
  function begin(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    finishDrag.current?.()
    const start = event.clientX; const width = geometry.width
    const move = (next: globalThis.PointerEvent) => update({ ...geometry, width: Math.min(640, Math.max(240, width + start - next.clientX)) })
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); finishDrag.current = undefined }
    finishDrag.current = finish
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish)
  }
  return { ...geometry, dock, resize: (width: number) => update({ ...geometry, width: Math.min(640, Math.max(240, width)) }), move: (dock: Dock) => update({ ...geometry, dock }), begin }
}

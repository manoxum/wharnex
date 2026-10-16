import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { OperationalTab } from './useOperationalTab'

function rememberedExpansion(projectPath: string) {
  try { return localStorage.getItem(`wharnex.workbench.bottom-expanded.v1:${projectPath}`) === 'true' } catch { return false }
}

export function useUtilityPanel({ projectPath, visible, tab, problemCount, height, onHeight, onOpen, onClose }: {
  projectPath: string; visible: boolean; tab: OperationalTab; problemCount: number | null; height: number
  onHeight: (height: number) => void; onOpen: () => void; onClose: () => void
}) {
  const root = useRef<HTMLElement>(null)
  const finishDrag = useRef<(() => void) | undefined>(undefined)
  const [manual, setManual] = useState(() => rememberedExpansion(projectPath))
  const [maximized, setMaximized] = useState(false)
  const [available, setAvailable] = useState(() => window.innerHeight - 96)
  useEffect(() => { setManual(rememberedExpansion(projectPath)); setMaximized(false) }, [projectPath])
  useEffect(() => {
    const parent = root.current?.parentElement
    if (!parent) return
    const measure = () => setAvailable(parent.clientHeight || window.innerHeight - 96)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(parent)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); finishDrag.current?.() }
  }, [])
  const maximum = Math.min(720, Math.max(96, available - Math.min(240, Math.round(available * 0.55))))
  const minimum = Math.min(185, maximum)
  const expanded = visible && (tab !== 'problems' || manual || problemCount !== null && problemCount > 0)
  const panelHeight = expanded ? (maximized ? Math.max(96, available - 64) : Math.min(maximum, Math.max(minimum, height))) : 40

  function remember(value: boolean) {
    setManual(value)
    try { localStorage.setItem(`wharnex.workbench.bottom-expanded.v1:${projectPath}`, String(value)) } catch { /* best effort */ }
  }
  function expand() { remember(true); onOpen() }
  function collapse() { remember(false); setMaximized(false); onClose() }
  function resize(next: number) { remember(true); setMaximized(false); onHeight(Math.round(Math.max(minimum, Math.min(maximum, next)))) }
  function beginResize(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    finishDrag.current?.()
    const startY = event.clientY
    const startHeight = panelHeight
    const previous = { cursor: document.body.style.cursor, userSelect: document.body.style.userSelect }
    document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none'
    const move = (pointer: globalThis.PointerEvent) => resize(startHeight + startY - pointer.clientY)
    const finish = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish)
      document.body.style.cursor = previous.cursor; document.body.style.userSelect = previous.userSelect
      finishDrag.current = undefined
    }
    finishDrag.current = finish
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish)
  }
  return { root, expanded, panelHeight, maximized, minimum, maximum, expand, collapse, resize, beginResize,
    toggleMaximize: () => { expand(); setMaximized((value) => !value) },
  }
}

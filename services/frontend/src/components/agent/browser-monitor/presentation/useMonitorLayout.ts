import { useEffect, useState } from 'react'
import { canFitMonitorPanels, resolveMonitorPanels } from './monitorLayoutModel'

const KEY = 'wharnex.browser-monitor.layout.v1'
type Panels = { list: boolean; details: boolean }
function load(): Panels {
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}'); return { list: saved.list !== false, details: saved.details !== false } }
  catch { return { list: true, details: true } }
}
export function useMonitorLayout(policiesOpen = false) {
  const [preferred, setPreferred] = useState(load)
  const [width, setWidth] = useState(() => window.innerWidth)
  const [overrides, setOverrides] = useState<Partial<Panels>>({})
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    const resize = () => { setWidth(window.innerWidth); setOverrides({}) }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => { setOverrides({}) }, [policiesOpen])
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(preferred)) } catch { /* best effort */ } }, [preferred])
  const visible = resolveMonitorPanels(width, {
    list: overrides.list ?? (width >= 640 && preferred.list),
    details: overrides.details ?? (width >= 900 && preferred.details),
  }, focused, policiesOpen)
  const listOpen = visible.list
  const detailsOpen = visible.details
  function toggle(panel: keyof Panels, current: boolean) {
    setFocused(false)
    setPreferred((value) => ({ ...value, [panel]: !current }))
    const other: keyof Panels = panel === 'list' ? 'details' : 'list'
    const yieldOther = !current && (width < 900 || (policiesOpen && !canFitMonitorPanels(width, true)))
    setOverrides((value) => ({ ...value, ...(yieldOther ? { [other]: false } : {}), [panel]: !current }))
  }
  return { listOpen, detailsOpen, focused, toggleList: () => toggle('list', listOpen), toggleDetails: () => toggle('details', detailsOpen), toggleFocus: () => setFocused((value) => !value) }
}

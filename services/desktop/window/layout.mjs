import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'

export const MIN_DESKTOP_WINDOW_SIZE = Object.freeze({ width: 1100, height: 720 })
const DEFAULT_DESKTOP_WINDOW_SIZE = Object.freeze({ width: 1540, height: 960 })
const WINDOW_ID = /^[A-Za-z0-9_-]{1,80}$/
// The filename is persisted state and keeps its shipped spelling.
const LAYOUT_FILENAME = 'wharness-window-layout.json'

function normalizedWindowSize(value) {
  const width = Number(value?.width)
  const height = Number(value?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined
  if (width < MIN_DESKTOP_WINDOW_SIZE.width || height < MIN_DESKTOP_WINDOW_SIZE.height) return undefined
  if (width > 8192 || height > 8192) return undefined
  return { width: Math.round(width), height: Math.round(height) }
}

function normalizedWindowBounds(value) {
  const size = normalizedWindowSize(value)
  if (!size) return undefined
  const x = Number(value?.x)
  const y = Number(value?.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100_000 || Math.abs(y) > 100_000) return size
  return { ...size, x: Math.round(x), y: Math.round(y) }
}

export function createDesktopWindowLayout({ userDataPath, windows, displays }) {
  const filename = () => path.join(userDataPath(), LAYOUT_FILENAME)
  let persistTimer

  function readState() {
    try {
      const parsed = JSON.parse(readFileSync(filename(), 'utf8'))
      const windows = Array.isArray(parsed?.windows) ? parsed.windows.filter((id) => typeof id === 'string' && WINDOW_ID.test(id)) : []
      const bounds = {}
      const maximized = {}
      const sourceBounds = parsed?.bounds && typeof parsed.bounds === 'object' ? parsed.bounds : parsed?.sizes && typeof parsed.sizes === 'object' ? parsed.sizes : {}
      for (const [id, value] of Object.entries(sourceBounds)) {
        if (!WINDOW_ID.test(id)) continue
        const placement = normalizedWindowBounds(value)
        if (placement) bounds[id] = placement
      }
      if (parsed?.maximized && typeof parsed.maximized === 'object') {
        for (const [id, value] of Object.entries(parsed.maximized)) if (WINDOW_ID.test(id) && value === true) maximized[id] = true
      }
      return { windows: windows.length ? [...new Set(windows)].slice(0, 12) : ['primary'], bounds, maximized }
    } catch { return { windows: ['primary'], bounds: {}, maximized: {} } }
  }

  function placementOf(windowState) {
    if (!windowState?.window || windowState.window.isDestroyed()) return undefined
    try {
      const raw = typeof windowState.window.getNormalBounds === 'function' ? windowState.window.getNormalBounds() : windowState.window.getBounds()
      return normalizedWindowBounds(raw)
    } catch { return undefined }
  }

  function persist(ids = [...windows.values()].filter((state) => !state.window.isDestroyed() && !state.transientSurface).map((state) => state.id)) {
    try {
      const previous = readState()
      const validIds = [...new Set(ids)].filter((id) => WINDOW_ID.test(id)).slice(0, 12)
      const bounds = {}
      const maximized = {}
      for (const id of validIds) {
        const live = windows.get(id)
        const placement = placementOf(live) || previous.bounds[id]
        if (placement) bounds[id] = placement
        if (live?.window && !live.window.isDestroyed() ? live.window.isMaximized() : previous.maximized[id]) maximized[id] = true
      }
      writeFileSync(filename(), JSON.stringify({ version: 3, windows: validIds, bounds, maximized }), { mode: 0o600 })
    } catch (error) { console.warn('[windows] layout persistence failed', error) }
  }

  function schedulePersistence() {
    clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      persist()
    }, 180)
  }

  function loadWindowLayout() { return readState().windows }

  function loadWindowPlacement(id) {
    const state = readState()
    const placement = state.bounds[id] || DEFAULT_DESKTOP_WINDOW_SIZE
    if (!('x' in placement) || !('y' in placement)) return { ...placement, maximized: Boolean(state.maximized[id]) }
    try {
      const visible = displays().some((display) => {
        const area = display.workArea
        return placement.x < area.x + area.width - 80 && placement.x + placement.width > area.x + 80 && placement.y < area.y + area.height - 60 && placement.y + placement.height > area.y + 60
      })
      return visible ? { ...placement, maximized: Boolean(state.maximized[id]) } : { ...DEFAULT_DESKTOP_WINDOW_SIZE, maximized: Boolean(state.maximized[id]) }
    } catch { return { ...placement, maximized: Boolean(state.maximized[id]) } }
  }

  return { persist, schedulePersistence, loadWindowLayout, loadWindowPlacement }
}

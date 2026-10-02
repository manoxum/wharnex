import { WORKBENCH_CENTRE_MIN_PX, WORKBENCH_SIDE_PANEL_MIN_PX } from '../layout/workbenchResize'

const WORKBENCH_STATE_VERSION = 1
const STORAGE_PREFIX = 'whx.workbench.layout.v1'
const LEGACY_DRAWER_WIDTH_PREFIX = 'whx.workspace.drawer-width'

export type WorkbenchSideTool = '' | 'attention' | 'archive' | 'todo' | 'project' | 'library' | 'knowledge' | 'git' | 'agents' | 'external-agents' | 'tasks' | 'errors' | 'evolution' | 'database' | 'docker' | 'ui-testing'
export type WorkbenchPanelState = { open: boolean; collapsed: boolean; size: number; tool?: WorkbenchSideTool }
export type WorkbenchState = {
  version: 1
  left: WorkbenchPanelState
  right: WorkbenchPanelState
  bottom: WorkbenchPanelState
}

export const DEFAULT_WORKBENCH_STATE: WorkbenchState = {
  version: WORKBENCH_STATE_VERSION,
  left: { open: false, collapsed: true, size: 320, tool: '' },
  right: { open: false, collapsed: true, size: 460, tool: 'database' },
  bottom: { open: false, collapsed: true, size: 275 },
}

// Both 44px activity rails plus the two 6px side splitters are fixed chrome,
// not part of the three resizable surfaces. Keeping this geometry accurate is
// what makes the initial 20% / 60% / 20% split real when both drawers are open.
const WORKBENCH_CHROME_WIDTH = 100
const SIDE_PANEL_FRACTION = 0.20

// With both side panels open the workbench opens as 20% / 60% / 20%: each
// drawer takes a fifth of what is left once the chrome is removed, so the
// centre keeps the remaining three fifths. This is only the starting point — the
// operator may drag either splitter freely afterwards, and no CSS floor pins
// the centre panel to a minimum width any more.
export function defaultSidePanelWidth(viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth) {
  const usable = Math.max(0, Math.round(viewportWidth) - WORKBENCH_CHROME_WIDTH)
  return usable > 0 ? Math.round(usable * SIDE_PANEL_FRACTION) : 0
}

// Persistence must not impose a second, arbitrary ceiling after the live
// splitter already accepted a width. Keep only a viewport safety bound that
// leaves the same recoverable centre reserve used during dragging.
function sidePanelMax(viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth) {
  const viewport = Math.round(Math.max(0, viewportWidth))
  return viewport > 0 ? Math.max(WORKBENCH_SIDE_PANEL_MIN_PX, viewport - WORKBENCH_CENTRE_MIN_PX) : Number.MAX_SAFE_INTEGER
}

export function loadWorkbenchState(projectPath: string): WorkbenchState {
  try {
    const raw = localStorage.getItem(storageKey(projectPath))
    if (raw) return normalizeWorkbenchState(JSON.parse(raw) as Partial<WorkbenchState>)
    const fallback = cloneDefault()
    const leftWidth = legacyDrawerWidth('left')
    const rightWidth = legacyDrawerWidth('right')
    fallback.left.size = clamp(leftWidth || defaultSidePanelWidth() || fallback.left.size, WORKBENCH_SIDE_PANEL_MIN_PX, sidePanelMax())
    fallback.right.size = clamp(rightWidth || defaultSidePanelWidth() || fallback.right.size, WORKBENCH_SIDE_PANEL_MIN_PX, sidePanelMax())
    return fallback
  } catch { return cloneDefault() }
}

export function saveWorkbenchState(projectPath: string, state: WorkbenchState) {
  const normalized = normalizeWorkbenchState(state)
  try { localStorage.setItem(storageKey(projectPath), JSON.stringify(normalized)) } catch { /* best effort */ }
  return normalized
}

export function normalizeWorkbenchState(value: Partial<WorkbenchState>): WorkbenchState {
  return {
    version: WORKBENCH_STATE_VERSION,
    left: normalizePanel(value.left, DEFAULT_WORKBENCH_STATE.left, WORKBENCH_SIDE_PANEL_MIN_PX, sidePanelMax(), true),
    right: normalizePanel(value.right, DEFAULT_WORKBENCH_STATE.right, WORKBENCH_SIDE_PANEL_MIN_PX, sidePanelMax(), true),
    bottom: normalizePanel(value.bottom, DEFAULT_WORKBENCH_STATE.bottom, 185, 720),
  }
}

function normalizePanel(value: Partial<WorkbenchPanelState> | undefined, fallback: WorkbenchPanelState, min: number, max: number, side = false): WorkbenchPanelState {
  const size = Number(value?.size)
  const open = value?.open === true
  const tool = side && isWorkbenchSideTool(value?.tool) ? value?.tool : fallback.tool
  return {
    open,
    collapsed: value?.collapsed === undefined ? !open : value.collapsed === true,
    size: Number.isFinite(size) ? clamp(size, min, max) : fallback.size,
    ...(side ? { tool } : {}),
  }
}

function legacyDrawerWidth(side: 'left' | 'right') {
  try {
    const scope = new URLSearchParams(window.location.search).get('wharnessWindow') || 'web'
    const value = Number(localStorage.getItem(`${LEGACY_DRAWER_WIDTH_PREFIX}:${side}:${scope}`))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch { return 0 }
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, Math.round(value))) }
function isWorkbenchSideTool(value: unknown): value is WorkbenchSideTool { return typeof value === 'string' && ['', 'attention', 'archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'external-agents', 'tasks', 'errors', 'evolution', 'database', 'docker', 'ui-testing'].includes(value) }
function storageKey(projectPath: string) { return `${STORAGE_PREFIX}:${projectPath}` }
function cloneDefault(): WorkbenchState { return JSON.parse(JSON.stringify(DEFAULT_WORKBENCH_STATE)) as WorkbenchState }

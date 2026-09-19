const WORKBENCH_STATE_VERSION = 1
const STORAGE_PREFIX = 'whx.workbench.layout.v1'
const LEGACY_DRAWER_WIDTH_PREFIX = 'whx.workspace.drawer-width'

export type WorkbenchSideTool = '' | 'attention' | 'archive' | 'todo' | 'project' | 'library' | 'knowledge' | 'git' | 'agents' | 'tasks' | 'plans' | 'executions' | 'fifo' | 'evolution' | 'database'
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

// The activity rail plus the two splitters — the chrome that is never part of
// any of the three resizable panels.
const WORKBENCH_CHROME_WIDTH = 54
const SIDE_PANEL_FRACTION = 0.25

// With both side panels open the workbench opens as 25% / 50% / 25%: each
// drawer takes a quarter of what is left once the chrome is removed, so the
// centre keeps the remaining half. This is only the starting point — the
// operator may drag either splitter freely afterwards, and no CSS floor pins
// the centre panel to a minimum width any more.
export function defaultSidePanelWidth(viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth) {
  const usable = Math.max(0, Math.round(viewportWidth) - WORKBENCH_CHROME_WIDTH)
  return usable > 0 ? Math.round(usable * SIDE_PANEL_FRACTION) : 0
}

// A static ceiling would stop a wide screen from ever reaching that quarter,
// and would stop the operator from deliberately squeezing the centre.
function sidePanelMax(staticMax: number, viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth) {
  return Math.max(staticMax, Math.round(Math.max(0, viewportWidth) * 0.45))
}

export function loadWorkbenchState(projectPath: string): WorkbenchState {
  try {
    const raw = localStorage.getItem(storageKey(projectPath))
    if (raw) return normalizeWorkbenchState(JSON.parse(raw) as Partial<WorkbenchState>)
    const fallback = cloneDefault()
    const leftWidth = legacyDrawerWidth('left')
    const rightWidth = legacyDrawerWidth('right')
    fallback.left.size = clamp(leftWidth || defaultSidePanelWidth() || fallback.left.size, 240, sidePanelMax(720))
    fallback.right.size = clamp(rightWidth || defaultSidePanelWidth() || fallback.right.size, 360, sidePanelMax(840))
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
    left: normalizePanel(value.left, DEFAULT_WORKBENCH_STATE.left, 240, sidePanelMax(720), true),
    right: normalizePanel(value.right, DEFAULT_WORKBENCH_STATE.right, 360, sidePanelMax(840), true),
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
function isWorkbenchSideTool(value: unknown): value is WorkbenchSideTool { return typeof value === 'string' && ['', 'attention', 'archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'tasks', 'plans', 'executions', 'fifo', 'evolution', 'database'].includes(value) }
function storageKey(projectPath: string) { return `${STORAGE_PREFIX}:${projectPath}` }
function cloneDefault(): WorkbenchState { return JSON.parse(JSON.stringify(DEFAULT_WORKBENCH_STATE)) as WorkbenchState }

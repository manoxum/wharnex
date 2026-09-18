export type WorkspaceRailSide = 'left' | 'right'
export type WorkspaceTool = 'archive' | 'todo' | 'project' | 'library' | 'knowledge' | 'git' | 'agents' | 'tasks' | 'plans' | 'executions' | 'fifo' | 'evolution' | 'terminal' | 'database'
export type WorkspaceRailLayout = Record<WorkspaceRailSide, WorkspaceTool[]> & { pinned: Record<WorkspaceRailSide, WorkspaceTool[]> }

const STORAGE_KEY = 'whx.workspace.rail-layout.v4'
const LEGACY_STORAGE_KEYS = ['whx.workspace.rail-layout.v3', 'whx.workspace.rail-layout.v2', 'whx.workspace.rail-layout.v1']
const ALL_TOOLS: WorkspaceTool[] = ['archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'tasks', 'plans', 'executions', 'fifo', 'evolution', 'terminal', 'database']

export const DEFAULT_WORKSPACE_RAIL_LAYOUT: WorkspaceRailLayout = {
  left: ['archive', 'todo', 'library', 'knowledge', 'git', 'agents', 'tasks', 'plans', 'executions', 'fifo', 'evolution'],
  right: ['project', 'database'],
  pinned: { left: ['terminal'], right: [] },
}

export function loadWorkspaceRailLayout(scope = ''): WorkspaceRailLayout {
  try {
    const current = localStorage.getItem(storageKey(scope))
    if (current) return normalizeWorkspaceRailLayout(JSON.parse(current) as Partial<WorkspaceRailLayout>)
    for (const key of LEGACY_STORAGE_KEYS) {
      const raw = localStorage.getItem(legacyStorageKey(key, scope))
      if (raw) return migrateLegacyLayout(JSON.parse(raw) as Partial<WorkspaceRailLayout>, key.endsWith('.v1') || key.endsWith('.v2'))
    }
    return cloneDefault()
  } catch { return cloneDefault() }
}

export function saveWorkspaceRailLayout(layout: WorkspaceRailLayout, scope = '') {
  const normalized = normalizeWorkspaceRailLayout(layout)
  try { localStorage.setItem(storageKey(scope), JSON.stringify(normalized)) } catch { /* best effort */ }
  return normalized
}

export function moveWorkspaceTool(layout: WorkspaceRailLayout, tool: WorkspaceTool, side: WorkspaceRailSide, before?: WorkspaceTool, pinned = false): WorkspaceRailLayout {
  const next = normalizeWorkspaceRailLayout(layout)
  const source = pinned ? next.pinned[side] : next[side]
  if (tool === before && source.includes(tool)) return next
  next.left = next.left.filter((item) => item !== tool)
  next.right = next.right.filter((item) => item !== tool)
  next.pinned.left = next.pinned.left.filter((item) => item !== tool)
  next.pinned.right = next.pinned.right.filter((item) => item !== tool)
  const target = pinned ? [...next.pinned[side]] : [...next[side]]
  const beforeIndex = before ? target.indexOf(before) : -1
  target.splice(beforeIndex >= 0 ? beforeIndex : target.length, 0, tool)
  if (pinned) next.pinned[side] = target
  else next[side] = target
  return normalizeWorkspaceRailLayout(next)
}

export function normalizeWorkspaceRailLayout(value: Partial<WorkspaceRailLayout>): WorkspaceRailLayout {
  const seen = new Set<WorkspaceTool>()
  const normalizeList = (items: unknown): WorkspaceTool[] => Array.isArray(items) ? items.filter((item): item is WorkspaceTool => {
    if (!ALL_TOOLS.includes(item as WorkspaceTool) || seen.has(item as WorkspaceTool)) return false
    seen.add(item as WorkspaceTool)
    return true
  }) : []
  const left = normalizeList(value.left)
  const right = normalizeList(value.right)
  const pinnedValue = value.pinned || { left: [], right: [] }
  const pinned = { left: normalizeList(pinnedValue.left), right: normalizeList(pinnedValue.right) }
  for (const tool of ALL_TOOLS) {
    if (seen.has(tool)) continue
    if (DEFAULT_WORKSPACE_RAIL_LAYOUT.pinned.left.includes(tool)) pinned.left.push(tool)
    else if (DEFAULT_WORKSPACE_RAIL_LAYOUT.pinned.right.includes(tool)) pinned.right.push(tool)
    else if (DEFAULT_WORKSPACE_RAIL_LAYOUT.right.includes(tool)) right.push(tool)
    else left.push(tool)
    seen.add(tool)
  }
  return { left, right, pinned }
}

function migrateLegacyLayout(value: Partial<WorkspaceRailLayout>, moveProject: boolean) {
  const normalized = normalizeWorkspaceRailLayout({ ...value, pinned: { left: [], right: [] } })
  const terminalSide: WorkspaceRailSide = normalized.right.includes('terminal') ? 'right' : 'left'
  normalized.left = normalized.left.filter((tool) => tool !== 'terminal')
  normalized.right = normalized.right.filter((tool) => tool !== 'terminal')
  normalized.pinned.left = normalized.pinned.left.filter((tool) => tool !== 'terminal')
  normalized.pinned.right = normalized.pinned.right.filter((tool) => tool !== 'terminal')
  normalized.pinned[terminalSide].push('terminal')
  if (moveProject) {
    normalized.left = normalized.left.filter((tool) => tool !== 'project')
    normalized.right = ['project', ...normalized.right.filter((tool) => tool !== 'project')]
  }
  return normalizeWorkspaceRailLayout(normalized)
}

function storageKey(scope: string) { return scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY }
function legacyStorageKey(key: string, scope: string) { return scope && !key.endsWith('.v1') ? `${key}:${scope}` : key }
function cloneDefault(): WorkspaceRailLayout { return { left: [...DEFAULT_WORKSPACE_RAIL_LAYOUT.left], right: [...DEFAULT_WORKSPACE_RAIL_LAYOUT.right], pinned: { left: [...DEFAULT_WORKSPACE_RAIL_LAYOUT.pinned.left], right: [...DEFAULT_WORKSPACE_RAIL_LAYOUT.pinned.right] } } }

export type WorkspaceRailSide = 'left' | 'right'
export type WorkspaceTool = 'archive' | 'todo' | 'project' | 'library' | 'knowledge' | 'git' | 'agents' | 'tasks' | 'plans' | 'executions' | 'fifo' | 'evolution' | 'terminal' | 'database'
export type WorkspaceRailLayout = Record<WorkspaceRailSide, WorkspaceTool[]>

const STORAGE_KEY = 'whx.workspace.rail-layout.v3'
const LEGACY_STORAGE_KEYS = ['whx.workspace.rail-layout.v2', 'whx.workspace.rail-layout.v1']
const ALL_TOOLS: WorkspaceTool[] = ['archive', 'todo', 'project', 'library', 'knowledge', 'git', 'agents', 'tasks', 'plans', 'executions', 'fifo', 'evolution', 'terminal', 'database']

export const DEFAULT_WORKSPACE_RAIL_LAYOUT: WorkspaceRailLayout = {
  left: ['archive', 'todo', 'library', 'knowledge', 'git', 'agents', 'tasks', 'plans', 'executions', 'fifo', 'evolution', 'terminal'],
  right: ['project', 'database'],
}

export function loadWorkspaceRailLayout(scope = ''): WorkspaceRailLayout {
  try {
    const current = localStorage.getItem(storageKey(scope))
    if (current) return normalizeWorkspaceRailLayout(JSON.parse(current) as Partial<WorkspaceRailLayout>)
    for (const key of LEGACY_STORAGE_KEYS) {
      const raw = localStorage.getItem(scope && key.endsWith('.v2') ? `${key}:${scope}` : key)
      if (raw) return migrateLegacyLayout(JSON.parse(raw) as Partial<WorkspaceRailLayout>)
    }
    return cloneDefault()
  } catch { return cloneDefault() }
}

export function saveWorkspaceRailLayout(layout: WorkspaceRailLayout, scope = '') {
  const normalized = normalizeWorkspaceRailLayout(layout)
  try { localStorage.setItem(storageKey(scope), JSON.stringify(normalized)) } catch { /* best effort */ }
  return normalized
}

export function moveWorkspaceTool(layout: WorkspaceRailLayout, tool: WorkspaceTool, side: WorkspaceRailSide, before?: WorkspaceTool): WorkspaceRailLayout {
  const next = normalizeWorkspaceRailLayout(layout)
  if (tool === before && next[side].includes(tool)) return next
  next.left = next.left.filter((item) => item !== tool)
  next.right = next.right.filter((item) => item !== tool)
  const target = [...next[side]]
  const beforeIndex = before ? target.indexOf(before) : -1
  target.splice(beforeIndex >= 0 ? beforeIndex : target.length, 0, tool)
  next[side] = target
  return normalizeWorkspaceRailLayout(next)
}

export function normalizeWorkspaceRailLayout(value: Partial<WorkspaceRailLayout>): WorkspaceRailLayout {
  const seen = new Set<WorkspaceTool>()
  const normalizeSide = (items: unknown): WorkspaceTool[] => Array.isArray(items) ? items.filter((item): item is WorkspaceTool => {
    if (!ALL_TOOLS.includes(item as WorkspaceTool) || seen.has(item as WorkspaceTool)) return false
    seen.add(item as WorkspaceTool)
    return true
  }) : []
  const left = normalizeSide(value.left)
  const right = normalizeSide(value.right)
  for (const tool of ALL_TOOLS) if (!seen.has(tool)) (DEFAULT_WORKSPACE_RAIL_LAYOUT.right.includes(tool) ? right : left).push(tool)
  return { left, right }
}

function migrateLegacyLayout(value: Partial<WorkspaceRailLayout>) {
  const normalized = normalizeWorkspaceRailLayout(value)
  normalized.left = normalized.left.filter((tool) => tool !== 'project')
  normalized.right = ['project', ...normalized.right.filter((tool) => tool !== 'project')]
  return normalized
}

function storageKey(scope: string) { return scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY }
function cloneDefault(): WorkspaceRailLayout { return { left: [...DEFAULT_WORKSPACE_RAIL_LAYOUT.left], right: [...DEFAULT_WORKSPACE_RAIL_LAYOUT.right] } }

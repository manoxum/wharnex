export type WorkspaceRailSide = 'left' | 'right'
export type WorkspaceTool = 'archive' | 'project' | 'library' | 'knowledge' | 'git' | 'agents' | 'tasks' | 'plans' | 'executions' | 'fifo' | 'evolution' | 'terminal' | 'database'
export type WorkspaceRailLayout = Record<WorkspaceRailSide, WorkspaceTool[]>

const STORAGE_KEY = 'whx.workspace.rail-layout.v1'
const ALL_TOOLS: WorkspaceTool[] = ['archive', 'project', 'library', 'knowledge', 'git', 'agents', 'tasks', 'plans', 'executions', 'fifo', 'evolution', 'terminal', 'database']

export const DEFAULT_WORKSPACE_RAIL_LAYOUT: WorkspaceRailLayout = {
  left: ['archive', 'project', 'library', 'knowledge', 'git', 'agents', 'tasks', 'plans', 'executions', 'fifo', 'evolution', 'terminal'],
  right: ['database'],
}

export function loadWorkspaceRailLayout(): WorkspaceRailLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeWorkspaceRailLayout(JSON.parse(raw) as Partial<WorkspaceRailLayout>) : cloneDefault()
  } catch { return cloneDefault() }
}

export function saveWorkspaceRailLayout(layout: WorkspaceRailLayout) {
  const normalized = normalizeWorkspaceRailLayout(layout)
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)) } catch { /* best effort */ }
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

function cloneDefault(): WorkspaceRailLayout { return { left: [...DEFAULT_WORKSPACE_RAIL_LAYOUT.left], right: [...DEFAULT_WORKSPACE_RAIL_LAYOUT.right] } }

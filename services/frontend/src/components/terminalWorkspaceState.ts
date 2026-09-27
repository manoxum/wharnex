import type { Session } from '../types'
import { MAX_PERSISTED_TERMINAL_HISTORY } from './interactiveTerminalSupport'

export type PersistedTerminalTab = {
  id: number
  label: string
  terminalID: string
  cwd: string
  history: string
  viewportY: number
}

const TERMINAL_WORKSPACE_PREFIX = 'whx.terminal.workspace.v1:'
const TERMINAL_GENERATION_KEY = 'whx.terminal.generation.v1'
export const TERMINALS_EXPIRED_EVENT = 'whx:terminals-expired'

export function observeTerminalGeneration(generation: string, unknownIsExpired = false): boolean {
  if (!generation) return false
  try {
    const previous = localStorage.getItem(TERMINAL_GENERATION_KEY)
    localStorage.setItem(TERMINAL_GENERATION_KEY, generation)
    return previous ? previous !== generation : unknownIsExpired
  } catch { return false }
}

export function expireTerminalWorkspaces() {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(TERMINAL_WORKSPACE_PREFIX)) localStorage.removeItem(key)
    }
  } catch { /* active tabs still reset when storage is unavailable */ }
  window.dispatchEvent(new Event(TERMINALS_EXPIRED_EVENT))
}

export function loadTerminalWorkspace(projectPath: string): { activeID: number; nextID: number; tabs: PersistedTerminalTab[] } {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${TERMINAL_WORKSPACE_PREFIX}${projectPath}`) || '{}')
    const tabs = Array.isArray(parsed?.tabs) ? parsed.tabs.slice(0, 12).flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return []
      const tab = value as Record<string, unknown>
      const id = Number(tab.id)
      if (!Number.isInteger(id) || id <= 0) return []
      const terminalID = String(tab.terminalID || '').slice(0, 128)
      return [{ id, label: String(tab.label || `Terminal ${id}`).slice(0, 120), terminalID, cwd: String(tab.cwd || '.').slice(0, 4096), history: String(tab.history || '').slice(-MAX_PERSISTED_TERMINAL_HISTORY), viewportY: Math.max(0, Math.floor(Number(tab.viewportY) || 0)) }]
    }) : []
    return { activeID: Number(parsed?.activeID) || tabs[0]?.id || 1, nextID: Math.max(Number(parsed?.nextID) || 2, ...tabs.map((tab: PersistedTerminalTab) => tab.id + 1)), tabs }
  } catch { return { activeID: 1, nextID: 2, tabs: [] } }
}

export type RestoredTerminalTab = PersistedTerminalTab & { session: Session; reconnectNonce: number; status: 'connecting' }

export function freshTerminalTab(session: Session, id: number, label = `Terminal ${id}`, cwd = '.'): RestoredTerminalTab {
  return { id, label, terminalID: '', session, reconnectNonce: 0, status: 'connecting', cwd, history: '', viewportY: 0 }
}

export function terminalTabsFromMemory(session: Session, tabs: PersistedTerminalTab[]): RestoredTerminalTab[] {
  const restored = tabs.map((tab) => ({ ...tab, session, reconnectNonce: 0, status: 'connecting' as const }))
  return restored.length ? restored : [freshTerminalTab(session, 1)]
}

export function saveTerminalWorkspace(projectPath: string, value: { activeID: number; nextID: number; tabs: PersistedTerminalTab[] }) {
  try {
    const tabs = value.tabs.slice(0, 12).map(({ id, label, terminalID, cwd, history, viewportY }) => ({ id, label, terminalID, cwd, history: history.slice(-MAX_PERSISTED_TERMINAL_HISTORY), viewportY }))
    localStorage.setItem(`${TERMINAL_WORKSPACE_PREFIX}${projectPath}`, JSON.stringify({ version: 1, activeID: value.activeID, nextID: value.nextID, tabs }))
  } catch { /* storage quota is best-effort */ }
}

import type { ChatItem, WorkspaceMode } from '../types'

const ACTIVE_KEY = 'kernl.workspace.active.v1'
const RECENT_KEY = 'kernl.workspace.recent.v1'
const CHAT_PREFIX = 'kernl.workspace.chat.v1:'

export type ActiveWorkspace = {
  sessionId: string
  projectPath: string
  mode: WorkspaceMode
}

export function loadActiveWorkspace(): ActiveWorkspace | undefined {
  try {
    const value = localStorage.getItem(ACTIVE_KEY)
    return value ? JSON.parse(value) as ActiveWorkspace : undefined
  } catch { return undefined }
}

export function saveActiveWorkspace(value: ActiveWorkspace) {
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify(value)) } catch { /* storage may be unavailable/full */ }
  rememberRecent(value.projectPath)
}

export function clearActiveWorkspace() {
  try { localStorage.removeItem(ACTIVE_KEY) } catch { /* storage unavailable */ }
}

export function loadRecentWorkspaces(): string[] {
  try {
    const value = localStorage.getItem(RECENT_KEY)
    const items = value ? JSON.parse(value) as string[] : []
    return Array.isArray(items) ? items.filter((item) => typeof item === 'string').slice(0, 8) : []
  } catch { return [] }
}

export function rememberRecent(projectPath: string) {
  const next = [projectPath, ...loadRecentWorkspaces().filter((item) => item !== projectPath)].slice(0, 8)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* storage unavailable/full */ }
}

export function loadChat(projectPath: string): ChatItem[] {
  try {
    const value = localStorage.getItem(CHAT_PREFIX + projectPath)
    return value ? JSON.parse(value) as ChatItem[] : []
  } catch { return [] }
}

export function saveChat(projectPath: string, items: ChatItem[]) {
  const compact = items.slice(-80).map((item) => ({ ...item, text: item.text.slice(0, 12000), meta: item.meta?.slice(0, 1000) }))
  try { localStorage.setItem(CHAT_PREFIX + projectPath, JSON.stringify(compact)) } catch { /* storage unavailable/full */ }
}

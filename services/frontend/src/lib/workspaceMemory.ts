import type { ChatItem, ExecutionMode, WorkspaceMode } from '../types'

const ACTIVE_KEY = 'kernl.workspace.active.v1'
const RECENT_KEY = 'kernl.workspace.recent.v1'
const LEGACY_CHAT_PREFIX = 'kernl.workspace.chat.v1:'
const CHAT_INDEX_PREFIX = 'kernl.workspace.chats.v2:'
const CHAT_ITEMS_PREFIX = 'kernl.workspace.chat.v2:'
const EXECUTION_MODE_PREFIX = 'kernl.workspace.execution-mode.v1:'

export type ActiveWorkspace = {
  sessionId: string
  projectPath: string
  mode: WorkspaceMode
  chatId?: string
  executionMode?: ExecutionMode
}

export type WorkspaceChat = {
  id: string
  title: string
  sessionId: string
  chatgptUrl?: string
  createdAt: string
  updatedAt: string
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


export function loadExecutionMode(projectPath: string): ExecutionMode {
  try {
    const value = localStorage.getItem(EXECUTION_MODE_PREFIX + projectPath)
    return value === 'unprotected' ? 'unprotected' : 'protected'
  } catch { return 'protected' }
}

export function saveExecutionMode(projectPath: string, mode: ExecutionMode) {
  try { localStorage.setItem(EXECUTION_MODE_PREFIX + projectPath, mode) } catch { /* storage unavailable/full */ }
}

export function loadWorkspaceChats(projectPath: string): WorkspaceChat[] {
  try {
    const raw = localStorage.getItem(CHAT_INDEX_PREFIX + projectPath)
    const parsed = raw ? JSON.parse(raw) as WorkspaceChat[] : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(validChat)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30)
  } catch { return [] }
}

export function saveWorkspaceChats(projectPath: string, chats: WorkspaceChat[]) {
  const normalized = chats.filter(validChat).slice(0, 30)
  try { localStorage.setItem(CHAT_INDEX_PREFIX + projectPath, JSON.stringify(normalized)) } catch { /* storage unavailable/full */ }
}

export function newWorkspaceChat(sessionId: string, title = 'Novo chat'): WorkspaceChat {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), title, sessionId, createdAt: now, updatedAt: now }
}

export function loadChat(projectPath: string, chatId: string): ChatItem[] {
  try {
    const value = localStorage.getItem(`${CHAT_ITEMS_PREFIX}${projectPath}:${chatId}`)
    return value ? JSON.parse(value) as ChatItem[] : []
  } catch { return [] }
}

export function saveChat(projectPath: string, chatId: string, items: ChatItem[]) {
  const compact = items.slice(-80).map((item) => ({ ...item, text: item.text.slice(0, 12000), meta: item.meta?.slice(0, 1000) }))
  try { localStorage.setItem(`${CHAT_ITEMS_PREFIX}${projectPath}:${chatId}`, JSON.stringify(compact)) } catch { /* storage unavailable/full */ }
}

export function loadLegacyChat(projectPath: string): ChatItem[] {
  try {
    const value = localStorage.getItem(LEGACY_CHAT_PREFIX + projectPath)
    return value ? JSON.parse(value) as ChatItem[] : []
  } catch { return [] }
}

export function deriveChatTitle(message: string) {
  const compact = message.replace(/\s+/g, ' ').trim()
  if (!compact) return 'Novo chat'
  return compact.length > 46 ? `${compact.slice(0, 43)}…` : compact
}

function validChat(value: WorkspaceChat) {
  return Boolean(value && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.sessionId === 'string' && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string')
}
